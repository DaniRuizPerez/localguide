/**
 * LiteRT (formerly TFLite) native module bridge for on-device Gemma inference.
 *
 * Native setup required:
 *   Android: implementation("com.google.ai.edge.litert:litert-lm:1.+") in build.gradle
 *            Place model file at android/app/src/main/assets/models/gemma3-1b-it-int4.task
 *   iOS:     pod 'LiteRT-LM' in Podfile
 *            Place model file in Xcode project under Resources/models/
 *
 * The native module must be registered as "LiteRTModule" in both platforms.
 */

import { NativeModules } from 'react-native';

export interface LiteRTNativeModule {
  /**
   * Load the model from the bundled assets into memory.
   * @param modelAssetName - filename relative to the models/ assets directory
   */
  loadModel(modelAssetName: string): Promise<void>;

  /**
   * Load the model from an absolute file path on device storage.
   * Use this when the model has been downloaded to the device at runtime.
   * @param absolutePath - full local filesystem path to the .task model file
   * @param multimodal - true for models with a vision encoder (Gemma 4 E2B);
   *   false for text-only models (Gemma 3 1B). Mis-setting this to true on a
   *   text-only model fails engine creation with "TF_LITE_VISION_ENCODER not
   *   found in the model".
   */
  loadModelFromPath(absolutePath: string, multimodal: boolean): Promise<void>;

  /**
   * Run a single-turn inference with the given prompt.
   * @param prompt - full formatted prompt string
   * @param maxTokens - maximum tokens to generate
   * @param imagePath - optional file://, absolute, or content:// URI to a photo
   *   the (multimodal) model should see alongside the prompt. Pass null for text-only.
   * @returns generated text response
   */
  runInference(prompt: string, maxTokens: number, imagePath: string | null): Promise<string>;

  /**
   * Start a streaming inference. Tokens are delivered via `LiteRTToken` events
   * with `{ requestId, delta }` payloads. `LiteRTDone` fires on success,
   * `LiteRTError` on failure. Only one stream is active at a time — starting
   * a new one aborts any in-flight stream silently. Pass `imagePath` to feed
   * a photo to a multimodal model (null = text-only).
   */
  runInferenceStream(prompt: string, requestId: string, imagePath: string | null): Promise<void>;

  /** Aborts the currently running streaming inference, if any. */
  abortInference(): Promise<void>;

  /**
   * Returns true if the model is currently loaded and ready.
   */
  isModelLoaded(): Promise<boolean>;

  /**
   * Returns the perf tier chosen for this device based on total RAM.
   * "low" = ≤ 4 GB (CPU, slow inference warning shown in UI),
   * "mid" = 4–6 GB (CPU, balanced), "high" = ≥ 6 GB (attempts GPU).
   * Safe to call before the model has been loaded.
   */
  getDeviceTier(): Promise<{
    tier: 'low' | 'mid' | 'high';
    cpuThreads: number;
    attemptGpu: boolean;
    totalRamMb: number;
  }>;

  /**
   * Unload the model and free device memory.
   */
  unloadModel(): Promise<void>;

  // RCTEventEmitter parity methods; not called from application code.
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export const LITERT_EVENT_TOKEN = 'LiteRTToken';
export const LITERT_EVENT_DONE = 'LiteRTDone';
export const LITERT_EVENT_ERROR = 'LiteRTError';

export interface LiteRTTokenEvent {
  requestId: string;
  delta: string;
}

export interface LiteRTDoneEvent {
  requestId: string;
}

export interface LiteRTErrorEvent {
  requestId: string;
  message: string;
}

const { LiteRTModule } = NativeModules;

if (!LiteRTModule) {
  console.warn(
    '[LiteRTModule] Native module not found. ' +
      'Run `expo run:ios` or `expo run:android` (not Expo Go) to enable on-device inference. ' +
      'InferenceService will fall back to mock responses in the meantime.'
  );
}

export default LiteRTModule as LiteRTNativeModule | undefined;
