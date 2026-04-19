import { NativeEventEmitter, NativeModules } from 'react-native';
import LiteRTModule, {
  LITERT_EVENT_DONE,
  LITERT_EVENT_ERROR,
  LITERT_EVENT_TOKEN,
  type LiteRTDoneEvent,
  type LiteRTErrorEvent,
  type LiteRTTokenEvent,
} from '../native/LiteRTModule';
import { MODEL_LOCAL_PATH } from './ModelDownloadService';
import * as FileSystem from 'expo-file-system/legacy';

const MODEL_ASSET_NAME = 'gemma3-1b-it-int4.task';
const DEFAULT_MAX_TOKENS = 512;

export interface InferenceOptions {
  maxTokens?: number;
  /** Optional file://, absolute, or content:// URI passed to the multimodal model. */
  imagePath?: string | null;
}

export interface GPSContext {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface StreamCallbacks {
  onToken: (delta: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

export interface StreamHandle {
  abort: () => Promise<void>;
}

export class InferenceService {
  private loaded = false;
  private loading = false;
  private emitter: NativeEventEmitter | null = null;
  private nextRequestId = 1;

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

    return LiteRTModule.runInference(prompt, maxTokens, options.imagePath ?? null);
  }

  /**
   * Start a streaming inference. `onToken` fires for each chunk delivered by the
   * native model, `onDone` when generation completes, `onError` on failure.
   * Returns a handle whose `abort()` cancels the in-flight generation.
   */
  async runInferenceStream(
    prompt: string,
    callbacks: StreamCallbacks,
    options: InferenceOptions = {}
  ): Promise<StreamHandle> {
    if (!this.loaded) {
      await this.initialize();
    }

    if (!LiteRTModule) {
      return this.mockStream(prompt, callbacks);
    }

    const requestId = `req-${Date.now()}-${this.nextRequestId++}`;
    const emitter = this.getEmitter();
    let settled = false;

    const cleanup = () => {
      tokenSub.remove();
      doneSub.remove();
      errorSub.remove();
    };

    const tokenSub = emitter.addListener(LITERT_EVENT_TOKEN, (evt: LiteRTTokenEvent) => {
      if (settled || evt.requestId !== requestId) return;
      callbacks.onToken(evt.delta);
    });
    const doneSub = emitter.addListener(LITERT_EVENT_DONE, (evt: LiteRTDoneEvent) => {
      if (settled || evt.requestId !== requestId) return;
      settled = true;
      cleanup();
      callbacks.onDone();
    });
    const errorSub = emitter.addListener(LITERT_EVENT_ERROR, (evt: LiteRTErrorEvent) => {
      if (settled || evt.requestId !== requestId) return;
      settled = true;
      cleanup();
      callbacks.onError(evt.message);
    });

    try {
      await LiteRTModule.runInferenceStream(prompt, requestId, options.imagePath ?? null);
    } catch (err) {
      if (!settled) {
        settled = true;
        cleanup();
        const message = err instanceof Error ? err.message : String(err);
        callbacks.onError(message);
      }
    }

    return {
      abort: async () => {
        if (settled) return;
        settled = true;
        cleanup();
        try {
          await LiteRTModule?.abortInference();
        } catch {
          // ignore
        }
      },
    };
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

  private getEmitter(): NativeEventEmitter {
    if (!this.emitter) {
      // Passing the native module to the emitter constructor silences the
      // "new NativeEventEmitter() was called without a module" warning on
      // React Native 0.65+.
      this.emitter = new NativeEventEmitter(NativeModules.LiteRTModule);
    }
    return this.emitter;
  }

  private mockResponse(_prompt: string): string {
    return (
      '[Dev mock] On-device Gemma inference not available — native LiteRT module not loaded. ' +
      'Build with `expo run:ios` or `expo run:android` to enable real inference.'
    );
  }

  private mockStream(_prompt: string, callbacks: StreamCallbacks): StreamHandle {
    const words = this.mockResponse(_prompt).split(' ');
    let i = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (i >= words.length) {
        callbacks.onDone();
        return;
      }
      callbacks.onToken((i === 0 ? '' : ' ') + words[i]);
      i += 1;
      setTimeout(tick, 60);
    };
    setTimeout(tick, 60);
    return {
      abort: async () => {
        cancelled = true;
      },
    };
  }
}

// Singleton — one model load shared across the app
export const inferenceService = new InferenceService();