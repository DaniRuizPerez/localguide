package com.localguideapp.litert

import android.net.Uri
import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.MessageCallback
import java.io.File
import java.util.concurrent.atomic.AtomicReference

@ReactModule(name = LiteRTModule.NAME)
class LiteRTModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private var engine: Engine? = null
    private val activeStream = AtomicReference<StreamHandle?>(null)

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
    fun runInference(prompt: String, maxTokens: Int, imagePath: String?, promise: Promise) {
        val currentEngine = engine
        if (currentEngine == null) {
            promise.reject("NOT_LOADED", "Model is not loaded")
            return
        }

        try {
            val contents = buildContents(prompt, imagePath)
            currentEngine.createConversation().use { conversation ->
                val response = conversation.sendMessage(contents)
                val text = extractText(response)
                promise.resolve(text)
            }
        } catch (e: Exception) {
            promise.reject("INFERENCE_ERROR", "Inference failed: ${e.message}", e)
        }
    }

    // Streaming inference. Emits EVENT_TOKEN for each new chunk, EVENT_DONE on success,
    // EVENT_ERROR on failure. `requestId` correlates events with the JS-side listener.
    // Only one stream can be active at a time; starting a new one aborts the previous.
    @ReactMethod
    fun runInferenceStream(prompt: String, requestId: String, imagePath: String?, promise: Promise) {
        val currentEngine = engine
        if (currentEngine == null) {
            promise.reject("NOT_LOADED", "Model is not loaded")
            return
        }

        abortActiveStream()

        try {
            val contents = buildContents(prompt, imagePath)
            val conversation = currentEngine.createConversation()
            val handle = StreamHandle(requestId, conversation)
            activeStream.set(handle)

            val callback = object : MessageCallback {
                private var emittedChars = 0

                override fun onMessage(message: Message) {
                    if (activeStream.get()?.requestId != requestId) return
                    val full = extractText(message)
                    if (full.length > emittedChars) {
                        val delta = full.substring(emittedChars)
                        emittedChars = full.length
                        emitToken(requestId, delta)
                    }
                }

                override fun onDone() {
                    if (activeStream.compareAndSet(handle, null)) {
                        try { conversation.close() } catch (_: Throwable) {}
                        emitDone(requestId)
                    }
                }

                override fun onError(throwable: Throwable) {
                    if (activeStream.compareAndSet(handle, null)) {
                        try { conversation.close() } catch (_: Throwable) {}
                        emitError(requestId, throwable.message ?: throwable.javaClass.simpleName)
                    }
                }
            }

            conversation.sendMessageAsync(contents, callback)
            promise.resolve(null)
        } catch (e: Exception) {
            activeStream.set(null)
            promise.reject("INFERENCE_ERROR", "Failed to start stream: ${e.message}", e)
        }
    }

    private fun buildContents(prompt: String, imagePath: String?): Contents {
        if (imagePath.isNullOrBlank()) {
            return Contents.of(Content.Text(prompt))
        }
        val imageContent = resolveImageContent(imagePath)
        return Contents.of(Content.Text(prompt), imageContent)
    }

    // Accepts file:// URIs, plain absolute paths, or content:// URIs. For file paths
    // we hand the model an ImageFile (zero-copy); for content URIs we must read the
    // bytes ourselves since LiteRT-LM can't resolve ContentResolver handles.
    private fun resolveImageContent(uri: String): Content {
        if (uri.startsWith("file://")) {
            return Content.ImageFile(uri.removePrefix("file://"))
        }
        if (uri.startsWith("/")) {
            return Content.ImageFile(uri)
        }
        if (uri.startsWith("content://")) {
            val parsed = Uri.parse(uri)
            val bytes = reactApplicationContext.contentResolver.openInputStream(parsed)?.use { it.readBytes() }
                ?: throw IllegalArgumentException("Cannot open image at $uri")
            return Content.ImageBytes(bytes)
        }
        throw IllegalArgumentException("Unsupported image URI scheme: $uri")
    }

    @ReactMethod
    fun abortInference(promise: Promise) {
        abortActiveStream()
        promise.resolve(null)
    }

    private fun abortActiveStream() {
        val handle = activeStream.getAndSet(null) ?: return
        try {
            handle.conversation.cancelProcess()
        } catch (_: Throwable) {}
        try {
            handle.conversation.close()
        } catch (_: Throwable) {}
    }

    private fun extractText(message: Message): String =
        message.contents.contents
            .filterIsInstance<Content.Text>()
            .joinToString("") { it.text }

    private fun emitToken(requestId: String, delta: String) {
        val payload = Arguments.createMap().apply {
            putString("requestId", requestId)
            putString("delta", delta)
        }
        emit(EVENT_TOKEN, payload)
    }

    private fun emitDone(requestId: String) {
        val payload = Arguments.createMap().apply {
            putString("requestId", requestId)
        }
        emit(EVENT_DONE, payload)
    }

    private fun emitError(requestId: String, message: String) {
        val payload = Arguments.createMap().apply {
            putString("requestId", requestId)
            putString("message", message)
        }
        emit(EVENT_ERROR, payload)
    }

    private fun emit(eventName: String, payload: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, payload)
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for RCTEventEmitter parity; nothing to do.
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for RCTEventEmitter parity; nothing to do.
    }

    @ReactMethod
    fun isModelLoaded(promise: Promise) {
        promise.resolve(engine != null)
    }

    @ReactMethod
    fun unloadModel(promise: Promise) {
        try {
            abortActiveStream()
            engine?.close()
            engine = null
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("UNLOAD_ERROR", "Failed to unload model: ${e.message}", e)
        }
    }

    private data class StreamHandle(val requestId: String, val conversation: Conversation)

    companion object {
        const val NAME = "LiteRTModule"
        const val EVENT_TOKEN = "LiteRTToken"
        const val EVENT_DONE = "LiteRTDone"
        const val EVENT_ERROR = "LiteRTError"
    }
}
