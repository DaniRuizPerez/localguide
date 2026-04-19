package com.localguideapp.litert

import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import java.io.File

@ReactModule(name = LiteRTModule.NAME)
class LiteRTModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private var engine: Engine? = null

    override fun getName(): String = NAME

    @ReactMethod
    fun loadModel(modelAssetName: String, promise: Promise) {
        try {
            val modelFile = File(reactApplicationContext.cacheDir, modelAssetName)
            if (!modelFile.exists()) {
                reactApplicationContext.assets.open("models/$modelAssetName").use { input ->
                    modelFile.outputStream().use { output ->
                        input.copyTo(output)
                    }
                }
            }
            loadEngine(modelFile.absolutePath)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("LOAD_ERROR", "Failed to load LiteRT-LM model: ${e.message}", e)
        }
    }

    @ReactMethod
    fun loadModelFromPath(absolutePath: String, promise: Promise) {
        try {
            val cleanPath = if (absolutePath.startsWith("file://")) {
                absolutePath.substring(7)
            } else {
                absolutePath
            }

            val file = File(cleanPath)
            android.util.Log.d("LiteRTModule", "Loading model from: $cleanPath")
            android.util.Log.d("LiteRTModule", "File exists: ${file.exists()}, size: ${file.length()} bytes")

            if (!file.exists()) {
                promise.reject("LOAD_ERROR", "Model file not found at path: $cleanPath")
                return
            }

            if (file.length() < 100 * 1024 * 1024) {
                promise.reject("LOAD_ERROR", "Model file is too small (${file.length()} bytes). It might be corrupted.")
                return
            }

            loadEngine(cleanPath)
            promise.resolve(null)
        } catch (e: Exception) {
            android.util.Log.e("LiteRTModule", "Load error", e)
            promise.reject("LOAD_ERROR", "Failed to load LiteRT-LM model: ${e.message}", e)
        }
    }

    private fun loadEngine(modelPath: String) {
        engine?.close()
        val config = EngineConfig(modelPath = modelPath)
        val newEngine = Engine(config)
        newEngine.initialize()
        engine = newEngine
    }

    @ReactMethod
    fun runInference(prompt: String, maxTokens: Int, promise: Promise) {
        val currentEngine = engine
        if (currentEngine == null) {
            promise.reject("NOT_LOADED", "Model is not loaded")
            return
        }

        try {
            currentEngine.createConversation().use { conversation ->
                val response = conversation.sendMessage(prompt)
                val text = response.contents.contents
                    .filterIsInstance<Content.Text>()
                    .joinToString("") { it.text }
                promise.resolve(text)
            }
        } catch (e: Exception) {
            promise.reject("INFERENCE_ERROR", "Inference failed: ${e.message}", e)
        }
    }

    @ReactMethod
    fun isModelLoaded(promise: Promise) {
        promise.resolve(engine != null)
    }

    @ReactMethod
    fun unloadModel(promise: Promise) {
        try {
            engine?.close()
            engine = null
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("UNLOAD_ERROR", "Failed to unload model: ${e.message}", e)
        }
    }

    companion object {
        const val NAME = "LiteRTModule"
    }
}
