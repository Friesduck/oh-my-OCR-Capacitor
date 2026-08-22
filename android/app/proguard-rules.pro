-keep class ai.onnxruntime.** { *; }
-keep class com.benjaminwan.ocrlibrary.** { *; }
-keep class com.example.rapidocrcapacitor.OcrPlugin { *; }

# The upstream OcrLibrary AAR references this compile-time annotation only.
-dontwarn kotlinx.parcelize.Parcelize
