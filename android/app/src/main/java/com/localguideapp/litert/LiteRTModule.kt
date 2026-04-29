package com.localguideapp.litert

import android.app.ActivityManager
import android.content.Context
import android.net.Uri
import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.InputData
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.MessageCallback
import com.google.ai.edge.litertlm.ResponseCallback
import com.google.ai.edge.litertlm.SamplerConfig
import com.google.ai.edge.litertlm.Session
import com.google.ai.edge.litertlm.SessionConfig
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

@ReactModule(name = LiteRTModule.NAME)
class LiteRTModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private var engine: Engine? = null
    private var activeTier: DeviceTier = DeviceTier.LOW
    private val activeStream = AtomicReference<StreamHandle?>(null)
    // Single-thread executor serializes inference so one model can't be asked
    // to generate twice in parallel. `generateContentStream` is a blocking call
    // that delivers tokens via callback; we need to run it off the RN module thread.
    private val inferenceExecutor = Executors.newSingleThreadExecutor()

    override fun getName(): String = NAME

    // Device-class profile. Each tier picks a trade-off between speed, quality, and
    // memory footprint. `topK` feeds SessionConfig so the sampler cost matches the
    // hardware. `maxTokens` sets the KV cache size — the single biggest CPU-perf lever:
    // prefill and per-decode attention cost both scale with context length, so a
    // smaller KV cache on a slow device is dramatically faster.
    enum class DeviceTier(
        val tierName: String,
        val maxTokens: Int,
        val topK: Int,
        val cpuThreads: Int,
        val attemptGpu: Boolean,
    ) {
        // maxTokens is the TOTAL KV-cache size (prompt + generated tokens). The model's
        // compiled prefill subgraphs are `prefill_128` and `prefill_1024`; for prompts
        // above 128 tokens the runtime uses `prefill_1024`, which needs headroom in the
        // KV cache beyond its own write size (otherwise DYNAMIC_UPDATE_SLICE overflows
        // and prefill fails with "INTERNAL: ERROR" at llm_litert_compiled_model_executor.cc:780).
        // 2048 is the smallest safe value for real queries; 1024 crashes.
        //
        // topK=1 on LOW is greedy sampling (skips softmax sort per token); HIGH uses 40
        // for richer output where GPU has spare throughput.
        LOW("low", maxTokens = 2048, topK = 1, cpuThreads = 4, attemptGpu = false),
        MID("mid", maxTokens = 2048, topK = 20, cpuThreads = 4, attemptGpu = false),
        HIGH("high", maxTokens = 2048, topK = 40, cpuThreads = 6, attemptGpu = true),
    }

    private fun selectDeviceTier(totalRamBytes: Long): DeviceTier = when {
        totalRamBytes >= 6L * 1024 * 1024 * 1024 -> DeviceTier.HIGH
        totalRamBytes >= 4L * 1024 * 1024 * 1024 -> DeviceTier.MID
        else -> DeviceTier.LOW
    }

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
            // Legacy asset-loader path: assumes the bundled model is multimodal
            // (Gemma 4 E2B). Runtime downloads always go through loadModelFromPath.
            loadEngine(modelFile.absolutePath, multimodal = true)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("LOAD_ERROR", "Failed to load LiteRT-LM model: ${e.message}", e)
        }
    }

    @ReactMethod
    fun loadModelFromPath(absolutePath: String, multimodal: Boolean, promise: Promise) {
        try {
            val cleanPath = if (absolutePath.startsWith("file://")) {
                absolutePath.substring(7)
            } else {
                absolutePath
            }

            val file = File(cleanPath)
            android.util.Log.d("LiteRTModule", "Loading model from: $cleanPath (multimodal=$multimodal)")
            android.util.Log.d("LiteRTModule", "File exists: ${file.exists()}, size: ${file.length()} bytes")

            if (!file.exists()) {
                promise.reject("LOAD_ERROR", "Model file not found at path: $cleanPath")
                return
            }

            if (file.length() < 100 * 1024 * 1024) {
                promise.reject("LOAD_ERROR", "Model file is too small (${file.length()} bytes). It might be corrupted.")
                return
            }

            loadEngine(cleanPath, multimodal)
            promise.resolve(null)
        } catch (e: Exception) {
            android.util.Log.e("LiteRTModule", "Load error", e)
            promise.reject("LOAD_ERROR", "Failed to load LiteRT-LM model: ${e.message}", e)
        }
    }

    private fun loadEngine(modelPath: String, multimodal: Boolean) {
        engine?.close()

        val totalRamBytes = deviceTotalRamBytes()
        val tier = selectDeviceTier(totalRamBytes)
        activeTier = tier

        // Cache dir is namespaced by tier so different maxTokens configs don't mix
        // (old cache compiled for a larger KV would be stale at a smaller one).
        val cacheDir = File(
            reactApplicationContext.cacheDir,
            "litertlm-kernels-${tier.tierName}-${tier.maxTokens}"
        ).apply { if (!exists()) mkdirs() }.absolutePath

        // On big.LITTLE chips, using half the cores (capped at `tier.cpuThreads`) keeps
        // work on the performance cluster — spanning both clusters costs more in
        // cross-cache migration than the little cores contribute.
        val cpuThreads = (Runtime.getRuntime().availableProcessors() / 2)
            .coerceAtLeast(2)
            .coerceAtMost(tier.cpuThreads)

        // Text-only models (e.g. Gemma 3 1B) have no TF_LITE_VISION_ENCODER
        // section, so configuring visionBackend / maxNumImages makes the runtime
        // fail with "NOT_FOUND: TF_LITE_VISION_ENCODER not found in the model."
        // Only wire vision when the caller says the model actually has it.
        fun cpuConfig() = if (multimodal) {
            EngineConfig(
                modelPath = modelPath,
                backend = Backend.CPU(cpuThreads),
                visionBackend = Backend.CPU(),
                maxNumImages = 1,
                maxNumTokens = tier.maxTokens,
                cacheDir = cacheDir,
            )
        } else {
            EngineConfig(
                modelPath = modelPath,
                backend = Backend.CPU(cpuThreads),
                maxNumTokens = tier.maxTokens,
                cacheDir = cacheDir,
            )
        }

        android.util.Log.i(
            "LiteRTModule",
            "Device RAM: ${totalRamBytes / (1024 * 1024)} MB; " +
                "tier=${tier.tierName} maxTokens=${tier.maxTokens} " +
                "topK=${tier.topK} cpuThreads=$cpuThreads attemptGpu=${tier.attemptGpu} " +
                "multimodal=$multimodal"
        )

        engine = if (tier.attemptGpu) {
            try {
                val gpuEngine = Engine(
                    if (multimodal) EngineConfig(
                        modelPath = modelPath,
                        backend = Backend.GPU(),
                        visionBackend = Backend.CPU(),
                        maxNumImages = 1,
                        maxNumTokens = tier.maxTokens,
                        cacheDir = cacheDir,
                    ) else EngineConfig(
                        modelPath = modelPath,
                        backend = Backend.GPU(),
                        maxNumTokens = tier.maxTokens,
                        cacheDir = cacheDir,
                    )
                )
                gpuEngine.initialize()
                android.util.Log.i("LiteRTModule", "Engine loaded with GPU backend (${tier.tierName} tier)")
                gpuEngine
            } catch (e: Throwable) {
                android.util.Log.w("LiteRTModule", "GPU backend failed (${e.message}); falling back to CPU", e)
                val cpuEngine = Engine(cpuConfig())
                cpuEngine.initialize()
                android.util.Log.i("LiteRTModule", "Engine loaded with CPU fallback ($cpuThreads threads)")
                cpuEngine
            }
        } else {
            val cpuEngine = Engine(cpuConfig())
            cpuEngine.initialize()
            android.util.Log.i(
                "LiteRTModule",
                "Engine loaded with CPU backend ($cpuThreads threads, ${tier.tierName} tier)"
            )
            cpuEngine
        }

        // Warmup runs synchronously and blocks loadModel's promise. The UI shows a
        // dedicated "Getting ready" screen while this finishes, so the cost is paid
        // during a clearly-telegraphed loading state instead of surprising the user
        // on their first query. Warms: graph delegation for prefill AND decode
        // subgraphs, XNNPack partition compilation, weight scratch buffers. Decode
        // cost specifically (~15 s cold on Pixel 3) is the dominant first-query
        // latency, so paying it here saves every user query after.
        warmupEngine()
    }

    // Pre-runs a short generation to warm graph delegation + allocator + decode subgraph.
    // Uses a prompt >128 tokens so the prefill_1024 subgraph is exercised — the short
    // "hi" prompt only warmed prefill_128 and let a prefill_1024-shape bug hide until
    // the first real user query. Non-fatal on failure.
    private fun warmupEngine() {
        val e = engine ?: return
        val startMs = System.currentTimeMillis()
        // ~150-token prompt (matches the real user-prompt size class) so we hit
        // prefill_1024 rather than prefill_128 during warmup.
        val warmupPrompt = "<start_of_turn>user\n" +
            "You are a brief offline assistant. Reply in one short sentence. " +
            "The user is at a city center and wants to know about a famous nearby landmark. " +
            "Do not invent specific names or hours. Just say something general and friendly. " +
            "Say hello to the user and tell them you are ready to help." +
            "<end_of_turn>\n<start_of_turn>model\n"
        try {
            e.createSession(
                SessionConfig(SamplerConfig(topK = 1, topP = 1.0, temperature = 0.0, seed = 0))
            ).use { session ->
                session.generateContentStream(
                    listOf(InputData.Text(warmupPrompt)),
                    object : ResponseCallback {
                        private var tokensSeen = 0
                        override fun onNext(response: String) {
                            tokensSeen += 1
                            // One decode token is enough to warm the decode subgraph;
                            // cancel to save the rest.
                            if (tokensSeen >= 1) {
                                try { session.cancelProcess() } catch (_: Throwable) {}
                            }
                        }
                        override fun onDone() {}
                        override fun onError(throwable: Throwable) {}
                    },
                )
            }
            android.util.Log.i("LiteRTModule", "Warmup complete in ${System.currentTimeMillis() - startMs} ms")
        } catch (t: Throwable) {
            android.util.Log.w("LiteRTModule", "Warmup failed (non-fatal): ${t.message}")
        }
    }

    private fun deviceTotalRamBytes(): Long {
        return try {
            val am = reactApplicationContext.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val info = ActivityManager.MemoryInfo()
            am.getMemoryInfo(info)
            info.totalMem
        } catch (_: Throwable) {
            0L
        }
    }

    @ReactMethod
    fun runInference(prompt: String, maxTokens: Int, imagePath: String?, promise: Promise) {
        val currentEngine = engine
        if (currentEngine == null) {
            promise.reject("NOT_LOADED", "Model is not loaded")
            return
        }

        // The engine only allows one live Session OR Conversation at a time —
        // starting a Conversation while a streaming Session is open throws
        // "FAILED_PRECONDITION: a session already exists". Aborting the active
        // stream synchronously closes whatever it held, and dispatching the
        // actual work through inferenceExecutor serializes this call behind
        // any in-flight streaming generation (the executor is single-threaded).
        abortActiveStream()
        inferenceExecutor.execute {
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
    }

    // Streaming inference. Emits EVENT_TOKEN for each new chunk, EVENT_DONE on success,
    // EVENT_ERROR on failure. `requestId` correlates events with the JS-side listener.
    // Only one stream can be active at a time; starting a new one aborts the previous.
    //
    // Two backends:
    //   * Text-only  → Session.generateContentStream + ResponseCallback (true per-token
    //                  streaming; no image preprocessing needed).
    //   * With image → Conversation.sendMessageAsync + MessageCallback. Session rejects
    //                  raw image bytes ("Image must be preprocessed") because it expects
    //                  already-preprocessed tensors; Conversation runs the vision encoder
    //                  natively when fed Content.ImageFile/ImageBytes.
    @ReactMethod
    fun runInferenceStream(
        prompt: String,
        requestId: String,
        maxTokens: Int,
        imagePath: String?,
        promise: Promise,
    ) {
        val currentEngine = engine
        if (currentEngine == null) {
            promise.reject("NOT_LOADED", "Model is not loaded")
            return
        }

        abortActiveStream()

        // Treat <= 0 as "unbounded" so callers (or older bundles still on the
        // pre-cap signature) keep the previous behaviour rather than producing
        // zero output. The reasonable cap for the on-device model is well
        // below the engine's kv-cache size; the JS side passes the per-task
        // budget here.
        val cap = if (maxTokens > 0) maxTokens else Int.MAX_VALUE
        if (!imagePath.isNullOrBlank()) {
            startConversationStream(currentEngine, prompt, requestId, cap, imagePath, promise)
        } else {
            startSessionStream(currentEngine, prompt, requestId, cap, promise)
        }
    }

    private fun startSessionStream(
        engine: Engine,
        prompt: String,
        requestId: String,
        maxTokens: Int,
        promise: Promise,
    ) {
        // Build inputs outside the executor so we can fail fast with a reject
        // — this is just string manipulation, no engine interaction.
        val inputs: List<InputData> = try {
            buildTextInputData(prompt)
        } catch (e: Exception) {
            promise.reject("INFERENCE_ERROR", "Failed to build inputs: ${e.message}", e)
            return
        }

        // All engine interaction (createSession + generateContentStream) runs
        // on the single-threaded executor so it serializes behind any in-flight
        // runInference/runInferenceStream call. Creating the session on the
        // module thread (the previous design) raced with executor tasks that
        // hadn't finished unwinding from generate, causing
        // "FAILED_PRECONDITION: a session already exists".
        inferenceExecutor.execute {
            val session: Session = try {
                engine.createSession(
                    SessionConfig(SamplerConfig(topK = activeTier.topK, topP = 0.95, temperature = 0.8, seed = 0))
                )
            } catch (e: Exception) {
                promise.reject("INFERENCE_ERROR", "Failed to create session: ${e.message}", e)
                return@execute
            }

            val handle = StreamHandle(
                requestId = requestId,
                cancel = { try { session.cancelProcess() } catch (_: Throwable) {} },
                close = {},  // close happens in the finally block below, on this same thread.
            )
            activeStream.set(handle)
            promise.resolve(null)

            try {
                val callback = object : ResponseCallback {
                    // Gemma decodes its end-of-turn marker to the literal string "<end_of_turn>".
                    // Depending on tokenizer behaviour, it can arrive either as one whole chunk
                    // or split across several onNext calls (e.g. "<end", "_of_turn>"). We keep
                    // a sliding buffer of the last (EOS.length - 1) chars held back so a partial
                    // match at the tail is never emitted; when the full marker assembles we
                    // trim it, emit what came before, cancel the session, and stop.
                    private val pending = StringBuilder()
                    private var eosSeen = false
                    private var capReached = false
                    // Each onNext chunk corresponds to roughly one decoded token in
                    // LiteRT-LM's streaming callback, so chunk count is a close proxy
                    // for token count without round-tripping through the tokenizer.
                    private var chunksEmitted = 0

                    override fun onNext(response: String) {
                        if (eosSeen || capReached) return
                        if (activeStream.get()?.requestId != requestId) return
                        if (response.isEmpty()) return

                        pending.append(response)
                        chunksEmitted += 1

                        val eosIdx = pending.indexOf(EOS_TOKEN)
                        if (eosIdx != -1) {
                            eosSeen = true
                            val before = pending.substring(0, eosIdx)
                            if (before.isNotEmpty()) emitToken(requestId, before)
                            pending.setLength(0)
                            if (activeStream.compareAndSet(handle, null)) {
                                try { session.cancelProcess() } catch (_: Throwable) {}
                                emitDone(requestId)
                            }
                            return
                        }

                        val holdback = EOS_TOKEN.length - 1
                        val safeLen = pending.length - holdback
                        if (safeLen > 0) {
                            emitToken(requestId, pending.substring(0, safeLen))
                            pending.delete(0, safeLen)
                        }

                        // Token cap: cancel cleanly so the engine releases the
                        // session before kv-cache exhaustion. Without this, prompts
                        // where Gemma fails to emit <end_of_turn> (small models
                        // drift on certain list tasks) run until the engine raises
                        // "Status Code: 13. Maximum kv-cache size reached".
                        if (chunksEmitted >= maxTokens) {
                            capReached = true
                            if (pending.isNotEmpty()) {
                                emitToken(requestId, pending.toString())
                                pending.setLength(0)
                            }
                            if (activeStream.compareAndSet(handle, null)) {
                                try { session.cancelProcess() } catch (_: Throwable) {}
                                emitDone(requestId)
                            }
                        }
                    }

                    override fun onDone() {
                        if (!eosSeen && pending.isNotEmpty()) {
                            emitToken(requestId, pending.toString())
                            pending.setLength(0)
                        }
                        if (activeStream.compareAndSet(handle, null)) {
                            emitDone(requestId)
                        }
                    }

                    override fun onError(throwable: Throwable) {
                        if (activeStream.compareAndSet(handle, null)) {
                            emitError(requestId, throwable.message ?: throwable.javaClass.simpleName)
                        }
                    }
                }

                try {
                    session.generateContentStream(inputs, callback)
                } catch (e: Throwable) {
                    if (activeStream.compareAndSet(handle, null)) {
                        emitError(requestId, e.message ?: e.javaClass.simpleName)
                    }
                }
            } finally {
                // Close on the executor thread, after generate has fully returned.
                // This is the one-and-only place the session gets closed, which
                // guarantees LiteRT-LM sees the close on the same thread that
                // created the session and before the next executor task runs.
                try { session.close() } catch (_: Throwable) {}
                activeStream.compareAndSet(handle, null)
            }
        }
    }

    private fun startConversationStream(
        engine: Engine,
        prompt: String,
        requestId: String,
        maxTokens: Int,
        imagePath: String,
        promise: Promise,
    ) {
        // See startSessionStream for the rationale — createConversation must
        // run on the executor thread to serialize with any in-flight engine
        // work, otherwise the engine slot collides.
        inferenceExecutor.execute {
            val contents: Contents = try {
                buildContents(prompt, imagePath)
            } catch (e: Exception) {
                promise.reject("INFERENCE_ERROR", "Failed to build contents: ${e.message}", e)
                return@execute
            }

            val conversation: Conversation = try {
                engine.createConversation()
            } catch (e: Exception) {
                promise.reject("INFERENCE_ERROR", "Failed to create conversation: ${e.message}", e)
                return@execute
            }

            // sendMessageAsync is non-blocking, so we can't close the conversation
            // in a try/finally around the call — that would close before the
            // async callbacks fire. Instead the conversation closes itself when
            // onDone / onError land (LiteRT-LM fires those on its own callback
            // thread AFTER the underlying generation has fully released the
            // engine slot, so close from there is safe).
            val handle = StreamHandle(
                requestId = requestId,
                cancel = { try { conversation.cancelProcess() } catch (_: Throwable) {} },
                close = { try { conversation.close() } catch (_: Throwable) {} },
            )
            activeStream.set(handle)
            promise.resolve(null)

            // MessageCallback.onMessage fires per-chunk with the incremental delta
            // (not the cumulative message), so emit extractText(message) directly.
            val callback = object : MessageCallback {
                private var chunksEmitted = 0
                private var capReached = false

                override fun onMessage(message: Message) {
                    if (capReached) return
                    if (activeStream.get()?.requestId != requestId) return
                    val delta = extractText(message)
                    if (delta.isNotEmpty()) {
                        emitToken(requestId, delta)
                        chunksEmitted += 1
                        if (chunksEmitted >= maxTokens) {
                            capReached = true
                            if (activeStream.compareAndSet(handle, null)) {
                                try { conversation.cancelProcess() } catch (_: Throwable) {}
                                handle.close()
                                emitDone(requestId)
                            }
                        }
                    }
                }

                override fun onDone() {
                    if (activeStream.compareAndSet(handle, null)) {
                        handle.close()
                        emitDone(requestId)
                    }
                }

                override fun onError(throwable: Throwable) {
                    if (activeStream.compareAndSet(handle, null)) {
                        handle.close()
                        emitError(requestId, throwable.message ?: throwable.javaClass.simpleName)
                    }
                }
            }

            try {
                conversation.sendMessageAsync(contents, callback)
            } catch (e: Throwable) {
                if (activeStream.compareAndSet(handle, null)) {
                    handle.close()
                    emitError(requestId, e.message ?: e.javaClass.simpleName)
                }
            }
        }
    }

    private fun buildTextInputData(prompt: String): List<InputData> {
        // Session.generateContentStream runs raw completion — it does NOT apply the
        // model's chat template. Without this, Gemma continues the user turn instead
        // of answering (e.g. emits `</user_message>` to close an unclosed tag).
        // Conversation.sendMessage applies this template internally; Session does not.
        val templated = applyGemmaChatTemplate(prompt)
        return listOf(InputData.Text(templated))
    }

    private fun applyGemmaChatTemplate(userPrompt: String): String =
        "<start_of_turn>user\n$userPrompt<end_of_turn>\n<start_of_turn>model\n"

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
        handle.cancel()
        // handle.close is a no-op for Session streams (the executor's finally
        // closes them on the thread that owns them — cross-thread close was
        // what caused "FAILED_PRECONDITION: a session already exists"). For
        // Conversation streams it still does the real close because the
        // sendMessageAsync callback may not fire after cancel in every case
        // and we'd otherwise leak the conversation.
        handle.close()
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

    // Returns "low" | "mid" | "high" based on device RAM. Safe to call before the
    // engine has been loaded — the tier is pure-function of RAM.
    @ReactMethod
    fun getDeviceTier(promise: Promise) {
        val tier = selectDeviceTier(deviceTotalRamBytes())
        val map = Arguments.createMap().apply {
            putString("tier", tier.tierName)
            putInt("cpuThreads", tier.cpuThreads)
            putBoolean("attemptGpu", tier.attemptGpu)
            putDouble("totalRamMb", (deviceTotalRamBytes() / (1024.0 * 1024.0)))
        }
        promise.resolve(map)
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

    private data class StreamHandle(
        val requestId: String,
        val cancel: () -> Unit,
        val close: () -> Unit,
    )

    companion object {
        const val NAME = "LiteRTModule"
        const val EVENT_TOKEN = "LiteRTToken"
        const val EVENT_DONE = "LiteRTDone"
        const val EVENT_ERROR = "LiteRTError"
        private const val EOS_TOKEN = "<end_of_turn>"
    }
}
