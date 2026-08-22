package com.example.rapidocrcapacitor

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.os.Build
import android.os.Debug
import android.os.SystemClock
import android.provider.OpenableColumns
import android.system.Os
import android.system.OsConstants
import android.util.Base64
import android.util.Log
import androidx.activity.result.ActivityResult
import androidx.exifinterface.media.ExifInterface
import com.benjaminwan.ocrlibrary.OcrEngine
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

@CapacitorPlugin(name = "NativeOcr")
class OcrPlugin : Plugin() {
    private val executor = Executors.newSingleThreadExecutor()
    private val recognitionInProgress = AtomicBoolean(false)

    @Volatile
    private var selectedImageUri: Uri? = null

    @Volatile
    private var ocrEngine: OcrEngine? = null

    @Volatile
    private var modelIsWarm = false

    @PluginMethod
    fun pickImage(call: PluginCall) {
        if (recognitionInProgress.get()) {
            call.reject("当前正在识别，请完成后再选择图片")
            return
        }

        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "image/*"
            putExtra(Intent.EXTRA_MIME_TYPES, SUPPORTED_MIME_TYPES.toTypedArray())
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

        runCatching {
            startActivityForResult(call, intent, "handleImagePicked")
        }.onFailure { error ->
            reject(call, error, "无法打开系统图片选择器")
        }
    }

    @ActivityCallback
    private fun handleImagePicked(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        if (result.resultCode != Activity.RESULT_OK) {
            call.resolve(JSObject().put("cancelled", true))
            return
        }

        val uri = result.data?.data
        if (uri == null) {
            call.reject("系统图片选择器没有返回有效图片")
            return
        }

        executor.execute {
            var imageBytes: ByteArray? = null
            try {
                val info = queryImageInfo(uri)
                info.sizeBytes?.let { size ->
                    require(size <= MAX_IMAGE_BYTES) { "图片不能超过 25 MB" }
                }
                info.mimeType?.let { mimeType ->
                    require(mimeType in SUPPORTED_MIME_TYPES) { "不支持的图片格式：$mimeType" }
                }

                val bytes = readImageBytes(uri)
                imageBytes = bytes
                val previewResult = createPreview(bytes)
                selectedImageUri = uri

                val response = JSObject().apply {
                    put("cancelled", false)
                    put("fileName", info.fileName)
                    put("mimeType", previewResult.mimeType)
                    info.sizeBytes?.let { put("sizeBytes", it) }
                    put("previewDataUrl", previewResult.dataUrl)
                }
                call.resolve(response)
            } catch (error: OutOfMemoryError) {
                selectedImageUri = null
                reject(call, error, "图片预览时内存不足，请选择分辨率更低的图片")
            } catch (error: Throwable) {
                selectedImageUri = null
                reject(call, error, "读取图片失败")
            } finally {
                imageBytes?.fill(0)
            }
        }
    }

    @PluginMethod
    fun clearSelection(call: PluginCall) {
        if (recognitionInProgress.get()) {
            call.reject("当前正在识别，暂时不能移除图片")
            return
        }
        selectedImageUri = null
        call.resolve()
    }

    @PluginMethod
    fun recognizeSelected(call: PluginCall) {
        val uri = selectedImageUri
        if (uri == null) {
            call.reject("请先选择一张图片")
            return
        }
        if (!recognitionInProgress.compareAndSet(false, true)) {
            call.reject("已有识别任务正在运行")
            return
        }

        executor.execute {
            val requestStartedAtNs = SystemClock.elapsedRealtimeNanos()
            val startedAtEpochMs = System.currentTimeMillis()
            val memorySnapshots = JSArray()
            var imageBytes: ByteArray? = null
            var bitmap: Bitmap? = null

            try {
                memorySnapshots.put(memorySnapshot("requestReceived", requestStartedAtNs))

                val imageReadStartedAtNs = SystemClock.elapsedRealtimeNanos()
                val bytes = readImageBytes(uri)
                imageBytes = bytes
                val imageReadMs = elapsedMs(imageReadStartedAtNs)
                memorySnapshots.put(memorySnapshot("imageBytesRead", requestStartedAtNs))

                val imageDecodeStartedAtNs = SystemClock.elapsedRealtimeNanos()
                val decodedBitmap = decodeSampledBitmap(bytes, MAX_DECODE_SIDE)
                val imageDecodeMs = elapsedMs(imageDecodeStartedAtNs)

                val orientationStartedAtNs = SystemClock.elapsedRealtimeNanos()
                val orientedBitmap = try {
                    applyExifOrientation(decodedBitmap, bytes)
                } catch (error: Throwable) {
                    decodedBitmap.recycleSafely()
                    throw error
                }
                bitmap = orientedBitmap
                val orientationMs = elapsedMs(orientationStartedAtNs)
                memorySnapshots.put(memorySnapshot("imageReady", requestStartedAtNs))

                val modelWasLoaded = modelIsWarm
                val engineInitStartedAtNs = SystemClock.elapsedRealtimeNanos()
                val engine = getEngine()
                val engineInitMs = elapsedMs(engineInitStartedAtNs)
                memorySnapshots.put(memorySnapshot("engineReady", requestStartedAtNs))

                val inferenceStartedAtNs = SystemClock.elapsedRealtimeNanos()
                val nativeResult = engine.detect(
                    orientedBitmap,
                    false,
                    1600,
                    50,
                    0.5f,
                    0.3f,
                    2.0f,
                    true,
                    true,
                )
                modelIsWarm = true
                val inferenceWallMs = elapsedMs(inferenceStartedAtNs)
                memorySnapshots.put(memorySnapshot("inferenceComplete", requestStartedAtNs))

                val postprocessStartedAtNs = SystemClock.elapsedRealtimeNanos()
                val textLines = try {
                    cleanTextLines(nativeResult.recResults.map { it.text })
                } finally {
                    if (nativeResult.boxImage !== orientedBitmap) {
                        nativeResult.boxImage.recycleSafely()
                    }
                }
                val idNumbers = IdCardParser.extract(textLines)
                val postprocessMs = elapsedMs(postprocessStartedAtNs)
                val ocrElapsedMs = nativeResult.fullTime.toLong()

                imageBytes?.fill(0)
                imageBytes = null
                bitmap.recycleSafely()
                bitmap = null
                memorySnapshots.put(memorySnapshot("resourcesReleased", requestStartedAtNs))

                val metrics = JSObject().apply {
                    put("startedAtEpochMs", startedAtEpochMs)
                    put("modelWasLoaded", modelWasLoaded)
                    put("imageReadMs", imageReadMs)
                    put("imageDecodeMs", imageDecodeMs)
                    put("orientationMs", orientationMs)
                    put("engineInitMs", engineInitMs)
                    put("inferenceWallMs", inferenceWallMs)
                    put("postprocessMs", postprocessMs)
                    put("nativeTotalMs", elapsedMs(requestStartedAtNs))
                    put("memorySnapshots", memorySnapshots)
                }
                val response = JSObject().apply {
                    put("idNumbers", JSArray(idNumbers))
                    put("textLines", JSArray(textLines))
                    put("elapsedMs", ocrElapsedMs)
                    put("metrics", metrics)
                }
                call.resolve(response)
            } catch (error: OutOfMemoryError) {
                reject(call, error, "图片处理时内存不足，请选择分辨率更低的图片")
            } catch (error: LinkageError) {
                reject(call, error, "OCR 原生库加载失败")
            } catch (error: Throwable) {
                reject(call, error, "OCR 识别失败")
            } finally {
                bitmap.recycleSafely()
                imageBytes?.fill(0)
                recognitionInProgress.set(false)
            }
        }
    }

    @PluginMethod
    fun copyText(call: PluginCall) {
        val value = call.getString("value")?.takeIf { it.isNotEmpty() }
        if (value == null) {
            call.reject("没有可复制的文字")
            return
        }
        if (value.length > MAX_CLIPBOARD_CHARS) {
            call.reject("复制内容过长")
            return
        }

        activity.runOnUiThread {
            runCatching {
                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("OCR 识别结果", value))
            }.onSuccess {
                call.resolve()
            }.onFailure { error ->
                reject(call, error, "复制失败")
            }
        }
    }

    override fun handleOnDestroy() {
        selectedImageUri = null
        ocrEngine = null
        modelIsWarm = false
        executor.shutdownNow()
        super.handleOnDestroy()
    }

    private fun getEngine(): OcrEngine {
        ocrEngine?.let { return it }
        return synchronized(this) {
            ocrEngine ?: run {
                loadOpenCv()
                OcrEngine(context.applicationContext).also { ocrEngine = it }
            }
        }
    }

    private fun loadOpenCv() {
        try {
            System.loadLibrary(OPENCV_LIBRARY_NAME)
        } catch (error: UnsatisfiedLinkError) {
            val pageSize = runCatching { Os.sysconf(OsConstants._SC_PAGESIZE) }
                .getOrNull()
                ?.toString()
                ?: "unknown"
            val message = buildString {
                append("OpenCV 原生库加载失败")
                append("；ABI=")
                append(Build.SUPPORTED_ABIS.joinToString())
                append("；pageSize=")
                append(pageSize)
                append("；nativeLibraryDir=")
                append(context.applicationInfo.nativeLibraryDir)
                error.message?.let {
                    append("；原因=")
                    append(it)
                }
            }
            Log.e(TAG, message, error)
            throw IllegalStateException(message, error)
        }
    }

    private fun queryImageInfo(uri: Uri): ImageInfo {
        var fileName = "已选择图片"
        var sizeBytes: Long? = null
        context.contentResolver.query(
            uri,
            arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
            null,
            null,
            null,
        )?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (nameIndex >= 0 && !cursor.isNull(nameIndex)) {
                    fileName = cursor.getString(nameIndex).orEmpty().ifBlank { fileName }
                }
                if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) {
                    sizeBytes = cursor.getLong(sizeIndex).takeIf { it >= 0 }
                }
            }
        }
        return ImageInfo(fileName, sizeBytes, context.contentResolver.getType(uri))
    }

    private fun readImageBytes(uri: Uri): ByteArray {
        val output = ByteArrayOutputStream()
        context.contentResolver.openInputStream(uri)?.use { input ->
            val buffer = ByteArray(STREAM_BUFFER_SIZE)
            var total = 0
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                total += count
                require(total <= MAX_IMAGE_BYTES) { "图片不能超过 25 MB" }
                output.write(buffer, 0, count)
            }
        } ?: error("无法打开所选图片")

        return output.toByteArray().also {
            require(it.isNotEmpty()) { "图片内容为空" }
        }
    }

    private fun createPreview(imageBytes: ByteArray): PreviewResult {
        val decodedBitmap = decodeSampledBitmap(imageBytes, MAX_PREVIEW_SIDE)
        val orientedBitmap = try {
            applyExifOrientation(decodedBitmap, imageBytes)
        } catch (error: Throwable) {
            decodedBitmap.recycleSafely()
            throw error
        }

        return try {
            val output = ByteArrayOutputStream()
            require(orientedBitmap.compress(Bitmap.CompressFormat.JPEG, PREVIEW_JPEG_QUALITY, output)) {
                "无法生成图片预览"
            }
            val previewBytes = output.toByteArray()
            try {
                PreviewResult(
                    mimeType = detectMimeType(imageBytes),
                    dataUrl = "data:image/jpeg;base64," +
                        Base64.encodeToString(previewBytes, Base64.NO_WRAP),
                )
            } finally {
                previewBytes.fill(0)
            }
        } finally {
            orientedBitmap.recycleSafely()
        }
    }

    private fun detectMimeType(imageBytes: ByteArray): String {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size, bounds)
        return bounds.outMimeType?.takeIf { it in SUPPORTED_MIME_TYPES }
            ?: error("请选择有效的 JPG、PNG 或 WEBP 图片")
    }

    private fun decodeSampledBitmap(imageBytes: ByteArray, maxSide: Int): Bitmap {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size, bounds)

        require(bounds.outWidth > 0 && bounds.outHeight > 0) {
            "无法读取图片尺寸，请选择有效图片"
        }
        require(bounds.outMimeType in SUPPORTED_MIME_TYPES) {
            "不支持的图片格式：${bounds.outMimeType ?: "unknown"}"
        }
        require(bounds.outWidth <= MAX_SOURCE_SIDE && bounds.outHeight <= MAX_SOURCE_SIDE) {
            "图片尺寸异常：${bounds.outWidth} x ${bounds.outHeight}"
        }

        var sampleSize = 1
        while (bounds.outWidth / sampleSize > maxSide || bounds.outHeight / sampleSize > maxSide) {
            sampleSize *= 2
        }

        val options = BitmapFactory.Options().apply {
            inSampleSize = sampleSize
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        return BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size, options)
            ?: error("无法解码图片，请选择有效图片")
    }

    private fun applyExifOrientation(bitmap: Bitmap, imageBytes: ByteArray): Bitmap {
        val orientation = runCatching {
            ByteArrayInputStream(imageBytes).use { input ->
                ExifInterface(input).getAttributeInt(
                    ExifInterface.TAG_ORIENTATION,
                    ExifInterface.ORIENTATION_NORMAL,
                )
            }
        }.getOrElse {
            Log.w(TAG, "无法读取图片 EXIF 方向，将按原方向识别", it)
            ExifInterface.ORIENTATION_NORMAL
        }

        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> {
                matrix.setRotate(90f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> {
                matrix.setRotate(-90f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(-90f)
        }

        if (matrix.isIdentity) return bitmap
        return Bitmap.createBitmap(
            bitmap,
            0,
            0,
            bitmap.width,
            bitmap.height,
            matrix,
            true,
        ).also { oriented ->
            if (oriented !== bitmap) bitmap.recycleSafely()
        }
    }

    private fun cleanTextLines(lines: List<String>): List<String> {
        val cleaned = mutableListOf<String>()
        lines.forEach { rawLine ->
            val line = rawLine.trim()
            if (line.isNotEmpty() && cleaned.lastOrNull() != line) cleaned += line
        }
        return cleaned
    }

    private fun memorySnapshot(stage: String, requestStartedAtNs: Long): JSObject {
        val runtime = Runtime.getRuntime()
        return JSObject().apply {
            put("stage", stage)
            put("elapsedMs", elapsedMs(requestStartedAtNs))
            put("javaHeapUsedBytes", runtime.totalMemory() - runtime.freeMemory())
            put("javaHeapMaxBytes", runtime.maxMemory())
            put(
                "nativeHeapAllocatedBytes",
                runCatching { Debug.getNativeHeapAllocatedSize() }.getOrDefault(0L),
            )
            put("totalPssKb", runCatching { Debug.getPss() }.getOrDefault(0L))
        }
    }

    private fun elapsedMs(startedAtNs: Long): Long =
        (SystemClock.elapsedRealtimeNanos() - startedAtNs) / 1_000_000L

    private fun reject(call: PluginCall, error: Throwable, contextMessage: String) {
        Log.e(TAG, contextMessage, error)
        call.reject("$contextMessage：${describeError(error)}")
    }

    private fun describeError(error: Throwable): String = generateSequence(error) { it.cause }
        .take(4)
        .map { cause ->
            val detail = cause.message?.trim().orEmpty()
            if (detail.isEmpty()) cause.javaClass.simpleName
            else "${cause.javaClass.simpleName}: $detail"
        }
        .distinct()
        .joinToString("；")

    private fun Bitmap?.recycleSafely() {
        if (this != null && !isRecycled) recycle()
    }

    private data class ImageInfo(
        val fileName: String,
        val sizeBytes: Long?,
        val mimeType: String?,
    )

    private data class PreviewResult(
        val mimeType: String,
        val dataUrl: String,
    )

    companion object {
        private const val TAG = "NativeOcr"
        private const val OPENCV_LIBRARY_NAME = "opencv_java4"
        private const val MAX_IMAGE_BYTES = 25 * 1024 * 1024
        private const val MAX_CLIPBOARD_CHARS = 500_000
        private const val MAX_SOURCE_SIDE = 50_000
        private const val MAX_DECODE_SIDE = 2_400
        private const val MAX_PREVIEW_SIDE = 1_000
        private const val PREVIEW_JPEG_QUALITY = 80
        private const val STREAM_BUFFER_SIZE = 16 * 1024
        private val SUPPORTED_MIME_TYPES = setOf("image/jpeg", "image/png", "image/webp")
    }
}

internal object IdCardParser {
    private val provinces = setOf(
        11, 12, 13, 14, 15, 21, 22, 23, 31, 32, 33, 34, 35, 36, 37,
        41, 42, 43, 44, 45, 46, 50, 51, 52, 53, 54, 61, 62, 63, 64, 65,
        71, 81, 82,
    )
    private val weights = intArrayOf(7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2)
    private const val checkCodes = "10X98765432"

    fun extract(lines: List<String>): List<String> {
        val results = mutableListOf<String>()
        val seen = linkedSetOf<String>()

        lines.forEach { line ->
            candidateChunks(line).forEach { chunk ->
                windows(chunk, 18).forEach { candidate ->
                    if (isValid18(candidate) && seen.add(candidate)) results += candidate
                }
                windows(chunk, 15).forEach { candidate ->
                    if (
                        isValid15(candidate) &&
                        results.none { it.contains(candidate) } &&
                        seen.add(candidate)
                    ) {
                        results += candidate
                    }
                }
            }
        }
        return results
    }

    private fun candidateChunks(line: String): List<String> {
        val chunks = mutableListOf<String>()
        val current = StringBuilder()

        fun flush() {
            if (current.isNotEmpty()) {
                chunks += current.toString()
                current.clear()
            }
        }

        line.forEach { character ->
            when (character) {
                in '０'..'９' -> {
                    current.append(('0'.code + character.code - '０'.code).toChar())
                }
                'x', 'ｘ', 'Ｘ' -> current.append('X')
                'O', 'o', 'Ｏ', 'ｏ', '〇' -> current.append('0')
                'I', 'i', 'l', 'L', 'Ｉ', 'ｉ', 'ｌ', 'Ｌ', '|' -> current.append('1')
                '-', '－', '—', '·' -> Unit
                else -> {
                    when {
                        character in '0'..'9' || character == 'X' -> current.append(character)
                        character.isWhitespace() -> Unit
                        else -> flush()
                    }
                }
            }
        }
        flush()
        return chunks
    }

    private fun windows(value: String, length: Int): Sequence<String> {
        if (value.length < length) return emptySequence()
        return (0..value.length - length).asSequence().map { start ->
            value.substring(start, start + length)
        }
    }

    private fun isValid18(candidate: String): Boolean {
        if (candidate.length != 18) return false
        if (!candidate.take(17).all(Char::isDigit)) return false
        if (!candidate.last().isDigit() && candidate.last() != 'X') return false
        if (!hasValidProvince(candidate) || candidate.substring(14, 17) == "000") return false

        val year = candidate.substring(6, 10).toIntOrNull() ?: return false
        val month = candidate.substring(10, 12).toIntOrNull() ?: return false
        val day = candidate.substring(12, 14).toIntOrNull() ?: return false
        if (!isValidDate(year, month, day)) return false

        val checksum = candidate.take(17)
            .mapIndexed { index, digit -> digit.digitToInt() * weights[index] }
            .sum()
        return candidate.last() == checkCodes[checksum % 11]
    }

    private fun isValid15(candidate: String): Boolean {
        if (candidate.length != 15 || !candidate.all(Char::isDigit)) return false
        if (!hasValidProvince(candidate) || candidate.substring(12, 15) == "000") return false

        val year = candidate.substring(6, 8).toIntOrNull()?.plus(1900) ?: return false
        val month = candidate.substring(8, 10).toIntOrNull() ?: return false
        val day = candidate.substring(10, 12).toIntOrNull() ?: return false
        return isValidDate(year, month, day)
    }

    private fun hasValidProvince(candidate: String): Boolean {
        val province = candidate.take(2).toIntOrNull() ?: return false
        return province in provinces
    }

    private fun isValidDate(year: Int, month: Int, day: Int): Boolean {
        if (year !in 1800..2099 || month !in 1..12) return false
        val leapYear = year % 400 == 0 || (year % 4 == 0 && year % 100 != 0)
        val daysInMonth = when (month) {
            2 -> if (leapYear) 29 else 28
            4, 6, 9, 11 -> 30
            else -> 31
        }
        return day in 1..daysInMonth
    }
}
