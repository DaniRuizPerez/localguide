/**
 * LiteRT (formerly TFLite) native module bridge for on-device Gemma inference.
 *
 * Native setup required:
 *   Android: implementation("com.google.ai.edge.litert:litert-lm:1.+") in build.gradle
 *            Place model file at android/app/src/main/assets/models/gemma-4-e2b-it-int4.task
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
   */
  loadModelFromPath(absolutePath: string): Promise<void>;

  /**
   * Run a single-turn inference with the given prompt.
   * @param prompt - full formatted prompt string
   * @param maxTokens - maximum tokens to generate
   * @returns generated text response
   */
  runInference(prompt: string, maxTokens: number): Promise<string>;

  /**
   * Returns true if the model is currently loaded and ready.
   */
  isModelLoaded(): Promise<boolean>;

  /**
   * Unload the model and free device memory.
   */
  unloadModel(): Promise<void>;
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
