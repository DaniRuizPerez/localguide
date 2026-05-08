import * as FileSystem from 'expo-file-system/legacy';
import * as Network from 'expo-network';

// Each device tier gets its own model. Small phones (<4 GB RAM) get Gemma 3 1B
// (~580 MB, text-only) so inference is actually usable; bigger phones get the
// multimodal Gemma 4 E2B. The runtime accepts both `.litertlm` and `.task` formats.
export type ModelProfileId = 'gemma-3-1b' | 'gemma-4-e2b';

export interface ModelProfile {
  id: ModelProfileId;
  displayName: string;
  url: string;
  fileName: string;
  approximateSizeMb: number;
  multimodal: boolean;
}

export const MODEL_PROFILES: Record<ModelProfileId, ModelProfile> = {
  'gemma-3-1b': {
    id: 'gemma-3-1b',
    displayName: 'Gemma 3 1B IT (INT4, text-only)',
    url: 'https://huggingface.co/litert-community/Gemma3-1B-IT/resolve/main/gemma3-1b-it-int4.litertlm',
    fileName: 'gemma3-1b-it-int4.litertlm',
    approximateSizeMb: 584,
    multimodal: false,
  },
  'gemma-4-e2b': {
    id: 'gemma-4-e2b',
    displayName: 'Gemma 4 E2B IT (INT4, multimodal)',
    url: 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm',
    fileName: 'gemma-4-E2B-it.litertlm',
    approximateSizeMb: 2600,
    multimodal: true,
  },
};

// Match LiteRTModule.DeviceTier. LOW gets the lightweight text-only model so
// Pixel-3-class hardware can actually keep up. Mirrors the `multimodal`
// FeatureFlag from deviceTier.ts — if a tier can't run the multimodal model,
// it gets the text-only profile.
import { featuresForTier, type DeviceTier } from './deviceTier';

export function profileForTier(tier: DeviceTier): ModelProfile {
  return featuresForTier(tier).multimodal
    ? MODEL_PROFILES['gemma-4-e2b']
    : MODEL_PROFILES['gemma-3-1b'];
}

export const MODEL_DIR = `${FileSystem.documentDirectory}models/`;

export type DownloadStatus = 'idle' | 'checking' | 'downloading' | 'paused' | 'done' | 'error' | 'cellular-warning';

export interface DownloadProgress {
  bytesDownloaded: number;
  bytesTotal: number;
  fraction: number;
}

export type ProgressCallback = (progress: DownloadProgress) => void;

export class ModelDownloadService {
  // Default to the multimodal 2B model; App.tsx resolves the real profile based
  // on device tier and calls `setActiveProfile` before any download starts.
  private activeProfile: ModelProfile = MODEL_PROFILES['gemma-4-e2b'];
  private downloadResumable: FileSystem.DownloadResumable | null = null;
  private _status: DownloadStatus = 'idle';
  private _error: string | null = null;

  get status(): DownloadStatus {
    return this._status;
  }

  get error(): string | null {
    return this._error;
  }

  get profile(): ModelProfile {
    return this.activeProfile;
  }

  get localPath(): string {
    return `${MODEL_DIR}${this.activeProfile.fileName}`;
  }

  setActiveProfile(profile: ModelProfile): void {
    if (profile.id === this.activeProfile.id) return;
    this.activeProfile = profile;
    // Any in-flight download handle is for the previous profile; drop it.
    this.downloadResumable = null;
    this._status = 'idle';
    this._error = null;
  }

  async isModelDownloaded(): Promise<boolean> {
    const info = await FileSystem.getInfoAsync(this.localPath);
    return info.exists && info.size !== undefined && info.size > 0;
  }

  // HuggingFace auth header for gated repos (e.g. litert-community/Gemma3-1B-IT).
  // The Bearer token only needs to ride on the initial HEAD to huggingface.co;
  // the redirect target (xethub CDN) carries its own signed query string and
  // rejects unrelated auth headers, so we strip before passing finalUrl to the
  // download resumable.
  private _hfAuthHeaders(): Record<string, string> {
    const token = process.env.EXPO_PUBLIC_HF_TOKEN;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /**
   * Fetches remote file size via HEAD request.
   * Returns null if server does not provide Content-Length.
   */
  async getRemoteFileSize(): Promise<number | null> {
    try {
      const response = await fetch(this.activeProfile.url, {
        method: 'HEAD',
        headers: this._hfAuthHeaders(),
      });
      const contentLength = response.headers.get('Content-Length');
      return contentLength ? parseInt(contentLength, 10) : null;
    } catch {
      return null;
    }
  }

  /**
   * Checks whether the device is on cellular. If so, emits 'cellular-warning'
   * status and returns true (the caller should prompt the user). Returns false
   * when it is safe to proceed immediately (Wi-Fi, Ethernet, or unknown).
   */
  async checkCellular(): Promise<boolean> {
    try {
      const state = await Network.getNetworkStateAsync();
      if (state.type === Network.NetworkStateType.CELLULAR) {
        this._status = 'cellular-warning';
        return true;
      }
      if (state.type === Network.NetworkStateType.NONE) {
        this._status = 'error';
        this._error = 'No internet connection. Connect to Wi-Fi or cellular and try again.';
        throw new Error(this._error);
      }
    } catch (err) {
      // If we can't determine network type, proceed anyway — don't block on it.
      if (this._status === 'error') throw err;
    }
    return false;
  }

  async startDownload(onProgress: ProgressCallback): Promise<void> {
    this._error = null;
    this._status = 'downloading';

    await this._ensureModelDir();

    try {
      const authHeaders = this._hfAuthHeaders();

      // 1. Probe with a HEAD so we can surface a clear error for gated/HTML
      // responses BEFORE starting the actual file download. We only use this
      // for error classification — we don't rely on `headResponse.url` for
      // redirect resolution because React Native's fetch doesn't reliably
      // expose the post-redirect URL on HEAD requests (that was causing 401s
      // when the original HF URL got passed back to the downloader without
      // the Bearer token). The native downloader below will follow the 302
      // to xethub itself, and OkHttp strips the Authorization header on
      // cross-host redirects so the Bearer never leaks to the CDN.
      const headResponse = await fetch(this.activeProfile.url, {
        method: 'HEAD',
        headers: authHeaders,
      });
      const contentType = headResponse.headers.get('Content-Type');

      if (headResponse.status === 401 || headResponse.status === 403) {
        const hasToken = !!process.env.EXPO_PUBLIC_HF_TOKEN;
        throw new Error(
          hasToken
            ? `HuggingFace rejected the auth token (status ${headResponse.status}). Make sure EXPO_PUBLIC_HF_TOKEN is a valid read token and you've accepted the Gemma license on ${this.activeProfile.url.split('/resolve/')[0]}.`
            : `This model repo is gated. Accept the Gemma license on ${this.activeProfile.url.split('/resolve/')[0]}, create a HuggingFace read token, and set EXPO_PUBLIC_HF_TOKEN before rebuilding.`
        );
      }

      if (contentType?.includes('text/html')) {
        throw new Error('The download URL returned an HTML page instead of a model file. The link might be expired or gated — accepting the Gemma license on the HuggingFace repo and using an auth token may be required.');
      }

      // 2. Clear any existing corrupted file
      const target = this.localPath;
      const info = await FileSystem.getInfoAsync(target);
      if (info.exists) {
        await FileSystem.deleteAsync(target, { idempotent: true });
      }

      // 3. Start the actual download from the original HF URL so the native
      // downloader can attach the Authorization header on the initial request.
      this.downloadResumable = FileSystem.createDownloadResumable(
        this.activeProfile.url,
        target,
        { headers: authHeaders },
        (downloadProgress) => {
          const { totalBytesWritten, totalBytesExpectedToWrite } = downloadProgress;
          onProgress({
            bytesDownloaded: totalBytesWritten,
            bytesTotal: totalBytesExpectedToWrite,
            fraction:
              totalBytesExpectedToWrite > 0
                ? totalBytesWritten / totalBytesExpectedToWrite
                : 0,
          });
        }
      );

      const result = await this.downloadResumable.downloadAsync();

      if (result && (result.status === 200 || result.status === 206)) {
        const finalInfo = await FileSystem.getInfoAsync(target);
        const actualSize = finalInfo.exists ? (finalInfo.size ?? 0) : 0;
        const MIN_SIZE = 100 * 1024 * 1024;

        if (actualSize > MIN_SIZE) {
          this._status = 'done';
          if (__DEV__) {
            console.log(`[ModelDownloadService] Download successful: ${actualSize} bytes`);
          }
        } else {
          throw new Error(`Downloaded file is too small (${actualSize} bytes).`);
        }
      } else {
        throw new Error(`Download failed with status ${result?.status ?? 'unknown'}`);
      }
    } catch (err) {
      this._status = 'error';
      this._error = err instanceof Error ? err.message : String(err);
      // Cleanup bad file on error
      try {
        await FileSystem.deleteAsync(this.localPath, { idempotent: true });
      } catch {}
      throw err;
    }
  }

  async pauseDownload(): Promise<void> {
    if (this.downloadResumable && this._status === 'downloading') {
      try {
        await this.downloadResumable.pauseAsync();
        this._status = 'paused';
      } catch (err) {
        this._error = err instanceof Error ? err.message : String(err);
        this._status = 'error';
      }
    }
  }

  async resumeDownload(onProgress: ProgressCallback): Promise<void> {
    if (!this.downloadResumable || this._status !== 'paused') return;

    this._status = 'downloading';
    try {
      const result = await this.downloadResumable.resumeAsync();
      if (result && result.status === 200) {
        this._status = 'done';
      } else {
        this._status = 'error';
        this._error = `Resume failed with status ${result?.status ?? 'unknown'}`;
      }
    } catch (err) {
      this._status = 'error';
      this._error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  async retryDownload(onProgress: ProgressCallback): Promise<void> {
    this.downloadResumable = null;
    // Delete partial file if present
    const info = await FileSystem.getInfoAsync(this.localPath);
    if (info.exists) {
      await FileSystem.deleteAsync(this.localPath, { idempotent: true });
    }
    this._status = 'idle';
    this._error = null;
    await this.startDownload(onProgress);
  }

  async deleteModel(): Promise<void> {
    await FileSystem.deleteAsync(this.localPath, { idempotent: true });
    this.downloadResumable = null;
    this._status = 'idle';
  }

  /**
   * Removes any model files in MODEL_DIR that don't match the active profile.
   * Useful when switching tiers (e.g. reinstall on different device class) so
   * we don't keep 2.6 GB of Gemma 4 on disk after downgrading to Gemma 3.
   */
  async cleanupOtherProfiles(): Promise<void> {
    try {
      const dirInfo = await FileSystem.getInfoAsync(MODEL_DIR);
      if (!dirInfo.exists) return;
      const entries = await FileSystem.readDirectoryAsync(MODEL_DIR);
      const keep = this.activeProfile.fileName;
      for (const name of entries) {
        if (name !== keep) {
          await FileSystem.deleteAsync(`${MODEL_DIR}${name}`, { idempotent: true });
        }
      }
    } catch (err) {
      console.warn('[ModelDownloadService] cleanup failed:', err);
    }
  }

  private async _ensureModelDir(): Promise<void> {
    const dirInfo = await FileSystem.getInfoAsync(MODEL_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true });
    }
  }
}

export const modelDownloadService = new ModelDownloadService();

// ── Back-compat exports ────────────────────────────────────────────────────
// Some call sites still reference the old constants. These now reflect the
// ACTIVE profile — don't rely on them as module-level constants anymore.
export const MODEL_DOWNLOAD_URL = modelDownloadService.profile.url;
export const MODEL_FILE_NAME = modelDownloadService.profile.fileName;
export const MODEL_LOCAL_PATH = modelDownloadService.localPath;
