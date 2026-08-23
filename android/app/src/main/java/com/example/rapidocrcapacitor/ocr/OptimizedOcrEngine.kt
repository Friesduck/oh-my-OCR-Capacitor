package com.example.rapidocrcapacitor.ocr

import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import android.os.SystemClock
import com.benjaminwan.ocrlibrary.models.DetResult
import com.benjaminwan.ocrlibrary.models.RecResult
import com.benjaminwan.ocrlibrary.models.ScaleParam
import org.opencv.android.Utils
import org.opencv.core.CvType
import org.opencv.core.Mat
import java.io.Closeable
import java.io.File

data class OptimizedOcrResult(
    val detResults: List<DetResult>,
    val recResults: List<RecResult>,
    val fullTimeMs: Long,
)

class OptimizedOcrEngine(context: Context) : Closeable {
    private val environment = OrtEnvironment.getEnvironment()
    private val sessions = ModelSessionFactory(context.applicationContext, environment)
    private val detector = TextDetector(environment) { sessions.create(DET_MODEL) }
    private val classifier = TextClassifier(environment) { sessions.create(CLS_MODEL) }
    private val recognizer = TextRecognizer(environment, context.assets, KEYS_FILE) {
        sessions.create(REC_MODEL)
    }

    fun detect(
        bitmap: Bitmap,
        scaleUp: Boolean,
        maxSideLen: Int,
        padding: Int,
        boxScoreThreshold: Float,
        boxThreshold: Float,
        unClipRatio: Float,
        classifyDirection: Boolean,
        useMajorityDirection: Boolean,
    ): OptimizedOcrResult {
        val startedAt = SystemClock.elapsedRealtimeNanos()
        val inputRgba = Mat(bitmap.height, bitmap.width, CvType.CV_8UC4)
        val inputBgr = Mat()
        var paddedInput: Mat? = null

        try {
            Utils.bitmapToMat(bitmap, inputRgba)
            org.opencv.imgproc.Imgproc.cvtColor(
                inputRgba,
                inputBgr,
                org.opencv.imgproc.Imgproc.COLOR_RGBA2BGR,
            )

            val sourceMaxSide = maxOf(inputBgr.cols(), inputBgr.rows())
            val scaledSide = when {
                maxSideLen <= 0 -> sourceMaxSide
                scaleUp -> maxSideLen
                sourceMaxSide > maxSideLen -> maxSideLen
                else -> sourceMaxSide
            } + 2 * padding

            val source = makePadding(inputBgr, padding).also { paddedInput = it }
            val scale = scaleParameters(source, scaledSide)
            val detections = detector.detect(
                source,
                scale,
                boxScoreThreshold,
                boxThreshold,
                unClipRatio,
            )
            val parts = cropTextRegions(source, detections)

            try {
                if (classifyDirection && parts.isNotEmpty()) {
                    val directions = classifier.classify(parts)
                    val majority = if (useMajorityDirection) {
                        directions.count { it.index == 1 } * 2 >= directions.size
                    } else {
                        false
                    }
                    parts.forEachIndexed { index, part ->
                        val rotate = if (useMajorityDirection) majority else directions[index].index == 1
                        if (rotate) rotate180(part)
                    }
                }

                return OptimizedOcrResult(
                    detResults = detections,
                    recResults = recognizer.recognize(parts),
                    fullTimeMs = elapsedMs(startedAt),
                )
            } finally {
                parts.forEach { it.release() }
            }
        } finally {
            paddedInput?.takeIf { it !== inputBgr }?.release()
            inputBgr.release()
            inputRgba.release()
        }
    }

    override fun close() {
        runCatching { recognizer.close() }
        runCatching { classifier.close() }
        runCatching { detector.close() }
        runCatching { environment.close() }
    }

    private fun elapsedMs(startedAt: Long): Long =
        (SystemClock.elapsedRealtimeNanos() - startedAt) / 1_000_000L

    private companion object {
        const val DET_MODEL = "ch_PP-OCRv3_det_infer.onnx"
        const val CLS_MODEL = "ch_ppocr_mobile_v2.0_cls_infer.onnx"
        const val REC_MODEL = "ch_PP-OCRv3_rec_infer.onnx"
        const val KEYS_FILE = "ppocr_keys_v1.txt"
    }
}

private class ModelSessionFactory(
    context: Context,
    private val environment: OrtEnvironment,
) {
    private val assets = context.assets
    private val modelDirectory = File(context.noBackupFilesDir, "ocr-models")

    fun create(modelName: String): OrtSession {
        val modelFile = ensureModelFile(modelName)
        val options = OrtSession.SessionOptions().apply {
            setCPUArenaAllocator(false)
            setMemoryPatternOptimization(false)
        }
        return try {
            environment.createSession(modelFile.absolutePath, options)
        } finally {
            options.close()
        }
    }

    private fun ensureModelFile(modelName: String): File {
        check(modelDirectory.exists() || modelDirectory.mkdirs()) {
            "无法创建 OCR 模型目录"
        }
        val target = File(modelDirectory, modelName)
        if (target.isFile && target.length() > 0L) return target

        val temporary = File(modelDirectory, "$modelName.tmp")
        assets.open(modelName).use { input ->
            temporary.outputStream().buffered().use { output -> input.copyTo(output) }
        }
        check(temporary.renameTo(target) || runCatching {
            temporary.copyTo(target, overwrite = true)
            temporary.delete()
            true
        }.getOrDefault(false)) {
            "无法准备 OCR 模型：$modelName"
        }
        return target
    }
}
