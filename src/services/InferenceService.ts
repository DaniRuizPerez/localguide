import LiteRTModule from '../native/LiteRTModule';
import { MODEL_LOCAL_PATH } from './ModelDownloadService';
import * as FileSystem from 'expo-file-system';

const MODEL_ASSET_NAME = 'gemma-4-e2b-it-int4.task';
const DEFAULT_MAX_TOKENS = 512;

export interface InferenceOptions {
  maxTokens?: number;
}

export interface GPSContext {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export class InferenceService {
  private loaded = false;
  private loading = false;

  async initialize(): Promise<void> {
    if (this.loaded || this.loading) return;

    if (!LiteRTModule) {
      // No native module — mock mode active
      this.loaded = true;
      return;
    }

    this.loading = true;
    try {
      const localInfo = await FileSystem.getInfoAsync(MODEL_LOCAL_PATH);
      if (localInfo.exists && localInfo.size !== undefined && localInfo.size > 0) {
        await LiteRTModule.loadModelFromPath(MODEL_LOCAL_PATH);
        console.log('[InferenceService] Gemma model loaded from local storage');
      } else {
        await LiteRTModule.loadModel(MODEL_ASSET_NAME);
        console.log('[InferenceService] Gemma model loaded from bundled assets');
      }
      this.loaded = true;
    } finally {
      this.loading = false;
    }
  }

  async runInference(prompt: string, options: InferenceOptions = {}): Promise<string> {
    if (!this.loaded) {
      await this.initialize();
    }

    const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;

    if (!LiteRTModule) {
      return this.mockResponse(prompt);
    }

    return LiteRTModule.runInference(prompt, maxTokens);
  }

  async dispose(): Promise<void> {
    if (LiteRTModule && this.loaded) {
      await LiteRTModule.unloadModel();
      this.loaded = false;
    }
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  private mockResponse(_prompt: string): string {
    return (
      '[Dev mock] On-device Gemma inference not available — native LiteRT module not loaded. ' +
      'Build with `expo run:ios` or `expo run:android` to enable real inference.'
    );
  }
}

// Singleton — one model load shared across the app
export const inferenceService = new InferenceService();
