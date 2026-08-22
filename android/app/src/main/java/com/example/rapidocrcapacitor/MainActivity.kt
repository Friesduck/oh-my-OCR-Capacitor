package com.example.rapidocrcapacitor

import android.os.Bundle
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(OcrPlugin::class.java)
        super.onCreate(savedInstanceState)

        val content = findViewById<View>(android.R.id.content)
        ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
            val safeArea = insets.getInsets(
                WindowInsetsCompat.Type.statusBars() or
                    WindowInsetsCompat.Type.displayCutout(),
            )
            view.setPadding(safeArea.left, safeArea.top, safeArea.right, 0)
            insets
        }
        ViewCompat.requestApplyInsets(content)
    }
}
