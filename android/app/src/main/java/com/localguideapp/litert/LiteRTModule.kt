package com.localguideapp.litert

import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule
import com.google.mediapipe.tasks.genai.llminference.LlmInference
import java.io.File

@ReactModule(name = LiteRTModule.NAME)
class LiteRTModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private var llmInference: LlmInference? = null

    override fun getName(): String = NAME

    @ReactMethod
    fun loadModel(modelAssetName: String, promise: Promise) {
        try {
            // LiteRT LM Inference expects a .task file.
            // For simplicity in this bridge, we assume the model is in assets/models/
            val modelFile = File(reactApplicationContext.cacheDir, modelAssetName)
            if (!modelFile.exists()) {
                reactApplicationContext.assets.open("models/$modelAssetName").use { input ->
                    modelFile.outputStream().use { output ->
                        input.copyTo(output)
                    }
                }
            }

            val options = LlmInference.LlmInferenceOptions.builder()
                .setModelPath(modelFile.absolutePath)
                .setMaxTokens(1024)
                .build()

            llmInference = LlmInference.createFromOptions(reactApplicationContext, options)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("LOAD_ERROR", "Failed to load LiteRT model: ${e.message}", e)
        }
    }

    @ReactMethod
    fun loadModelFromPath(absolutePath: String, promise: Promise) {
        try {
            val options = LlmInference.LlmInferenceOptions.builder()
                .setModelPath(absolutePath)
                .setMaxTokens(1024)
                .build()

            llmInference = LlmInference.createFromOptions(reactApplicationContext, options)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("LOAD_ERROR", "Failed to load LiteRT model from path: ${e.message}", e)
        }
    }

    @ReactMethod
    fun runInference(prompt: String, maxTokens: Int, promise: Promise) {
        val inference = llmInference
        if (inference == null) {
            promise.reject("NOT_LOADED", "Model is not loaded")
            return
        }

        try {
            // LlmInference.generateResponse is a synchronous call in 1.0.x
            val result = inference.generateResponse(prompt)
            promise.resolve(result)
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

    companion object {
        const val NAME = "LiteRTModule"
    }
}
