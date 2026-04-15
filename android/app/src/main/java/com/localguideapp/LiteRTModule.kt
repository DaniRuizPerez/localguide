package com.localguideapp

import com.facebook.react.bridge.*
import com.google.mediapipe.tasks.genai.llminference.LlmInference
import java.io.File

class LiteRTModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var llmInference: LlmInference? = null

    override fun getName(): String = "LiteRTModule"

    @ReactMethod
    fun loadModel(modelAssetName: String, promise: Promise) {
        try {
            val assetsDir = reactApplicationContext.filesDir
            val modelFile = File(assetsDir, "models/$modelAssetName")

            if (!modelFile.exists()) {
                modelFile.parentFile?.mkdirs()
                reactApplicationContext.assets.open("models/$modelAssetName").use { input ->
                    modelFile.outputStream().use { output ->
                        input.copyTo(output)
                    }
                }
            }

            loadFromPath(modelFile.absolutePath)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("LOAD_ERROR", "Failed to load model from assets: ${e.message}", e)
        }
    }

    @ReactMethod
    fun loadModelFromPath(absolutePath: String, promise: Promise) {
        try {
            loadFromPath(absolutePath)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("LOAD_ERROR", "Failed to load model from path: ${e.message}", e)
        }
    }

    @ReactMethod
    fun runInference(prompt: String, maxTokens: Int, promise: Promise) {
        val inference = llmInference
        if (inference == null) {
            promise.reject("NOT_LOADED", "Model not loaded. Call loadModel or loadModelFromPath first.")
            return
        }

        try {
            val response = inference.generateResponse(prompt)
            promise.resolve(response)
        } catch (e: Exception) {
            promise.reject("INFERENCE_ERROR", "Inference failed: ${e.message}", e)
        }
    }

    @ReactMethod
    fun isModelLoaded(promise: Promise) {
        promise.resolve(llmInference != null)
    }

    @ReactMethod
    fun unloadModel(promise: Promise) {
        try {
            llmInference?.close()
            llmInference = null
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("UNLOAD_ERROR", "Failed to unload model: ${e.message}", e)
        }
    }

    private fun loadFromPath(path: String) {
        llmInference?.close()

        val options = LlmInference.LlmInferenceOptions.builder()
            .setModelPath(path)
            .setMaxTokens(1024)
            .build()

        llmInference = LlmInference.createFromOptions(reactApplicationContext, options)
    }

    override fun onCatalystInstanceDestroy() {
        llmInference?.close()
        llmInference = null
    }
}
