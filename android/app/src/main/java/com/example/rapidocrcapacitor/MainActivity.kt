package com.example.rapidocrcapacitor

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(OcrPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
