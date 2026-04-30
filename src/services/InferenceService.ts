import { NativeEventEmitter, NativeModules } from 'react-native';
import LiteRTModule, {
  LITERT_EVENT_DONE,
  LITERT_EVENT_ERROR,
  LITERT_EVENT_TOKEN,
  type LiteRTDoneEvent,
  type LiteRTErrorEvent,
  type LiteRTTokenEvent,
} from '../native/LiteRTModule';
import { modelDownloadService } from './ModelDownloadService';
import * as FileSystem from 'expo-file-system/legacy';

const DEFAULT_MAX_TOKENS = 512;

export interface InferenceOptions {
  maxTokens?: number;
  /** Optional file://, absolute, or content:// URI passed to the multimodal model. */
  imagePath?: string | null;
  /**
   * Scheduling hint. 'normal' (default) calls bump a counter that 'low'
   * callers can wait for via {@link InferenceService.waitForIdleSlot}.
   * Used to keep background work like quiz pre-generation off the critical
   * path of foreground requests (nearby places, guide facts).
   */
  priority?: 'normal' | 'low';
}

export interface GPSContext {
  latitude: number;
  longitude: number;
  accuracy?: number;
  /**
   * Human-readable place name (city / neighborhood) derived from reverse
   * geocoding. Optional because geocoding is async — the GPS fix is usable
   * without it, and the UI should degrade gracefully while it's null.
   */
  placeName?: string;
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
  /**
   * Number of in-flight 'normal' priority calls. 'low' callers (the quiz
   * preloader) await this hitting zero before issuing their next request,
   * which keeps foreground features (nearby places, guide facts) ahead of
   * background work on the single-threaded LiteRT executor.
   */
  private pendingNormal = 0;
  private idleWaiters: Array<() => void> = [];

  async initialize(): Promise<void> {
    if (this.loaded || this.loading) return;

    if (!LiteRTModule) {
      // No native module — mock mode active
      this.loaded = true;
      return;
    }

    this.loading = true;
    try {
      const localPath = modelDownloadService.localPath;
      const profile = modelDownloadService.profile;
      const localInfo = await FileSystem.getInfoAsync(localPath);
      if (!localInfo.exists || localInfo.size === undefined || localInfo.size === 0) {
        throw new Error(
          `Model file missing at ${localPath}. Expected ${profile.displayName}. ` +
            `Open the app through the download screen to fetch it.`
        );
      }
      await LiteRTModule.loadModelFromPath(localPath, profile.multimodal);
      console.log(`[InferenceService] Loaded ${profile.displayName} from ${localPath}`);
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

    const priority = options.priority ?? 'normal';
    if (priority === 'normal') this.beginNormal();
    try {
      return await LiteRTModule.runInference(prompt, maxTokens, options.imagePath ?? null);
    } finally {
      if (priority === 'normal') this.endNormal();
    }
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

    const priority = options.priority ?? 'normal';
    if (priority === 'normal') this.beginNormal();

    const requestId = `req-${Date.now()}-${this.nextRequestId++}`;
    const emitter = this.getEmitter();
    let settled = false;
    let releasedNormal = false;

    const releaseNormal = () => {
      if (priority !== 'normal' || releasedNormal) return;
      releasedNormal = true;
      this.endNormal();
    };

    const cleanup = () => {
      tokenSub.remove();
      doneSub.remove();
      errorSub.remove();
      releaseNormal();
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
      const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
      console.log(`[InferenceService] runInferenceStream START requestId=${requestId} maxTokens=${maxTokens} priority=${priority}`);
      await LiteRTModule.runInferenceStream(
        prompt,
        requestId,
        maxTokens,
        options.imagePath ?? null
      );
      console.log(`[InferenceService] runInferenceStream native promise resolved requestId=${requestId}`);
    } catch (err) {
      console.warn(`[InferenceService] runInferenceStream native promise REJECTED requestId=${requestId}`, err);
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

  /**
   * Resolves once there are no in-flight 'normal' priority calls. Used by
   * background work (the quiz preloader) to yield the model to foreground
   * features. Returns immediately if already idle.
   */
  waitForIdleSlot(): Promise<void> {
    if (this.pendingNormal === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  /** Number of in-flight 'normal' priority requests — useful for diagnostics. */
  get pendingNormalCount(): number {
    return this.pendingNormal;
  }

  private beginNormal(): void {
    this.pendingNormal += 1;
  }

  private endNormal(): void {
    this.pendingNormal = Math.max(0, this.pendingNormal - 1);
    if (this.pendingNormal === 0 && this.idleWaiters.length > 0) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const w of waiters) w();
    }
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

  async getDeviceTier(): Promise<{
    tier: 'low' | 'mid' | 'high';
    cpuThreads: number;
    attemptGpu: boolean;
    totalRamMb: number;
  } | null> {
    if (!LiteRTModule) return null;
    return LiteRTModule.getDeviceTier();
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