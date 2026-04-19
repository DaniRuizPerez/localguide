import * as FileSystem from 'expo-file-system/legacy';

export const MODEL_DOWNLOAD_URL =
  'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm';

export const MODEL_FILE_NAME = 'gemma-4-E2B-it.litertlm';
export const MODEL_DIR = `${FileSystem.documentDirectory}models/`;
export const MODEL_LOCAL_PATH = `${MODEL_DIR}${MODEL_FILE_NAME}`;

export type DownloadStatus = 'idle' | 'checking' | 'downloading' | 'paused' | 'done' | 'error';

export interface DownloadProgress {
  bytesDownloaded: number;
  bytesTotal: number;
  fraction: number;
}

export type ProgressCallback = (progress: DownloadProgress) => void;

export class ModelDownloadService {
  private downloadResumable: FileSystem.DownloadResumable | null = null;
  private _status: DownloadStatus = 'idle';
  private _error: string | null = null;

  get status(): DownloadStatus {
    return this._status;
  }

  get error(): string | null {
    return this._error;
  }

  async isModelDownloaded(): Promise<boolean> {
    const info = await FileSystem.getInfoAsync(MODEL_LOCAL_PATH);
    return info.exists && info.size !== undefined && info.size > 0;
  }

  /**
   * Fetches remote file size via HEAD request.
   * Returns null if server does not provide Content-Length.
   */
  async getRemoteFileSize(): Promise<number | null> {
    try {
      const response = await fetch(MODEL_DOWNLOAD_URL, { method: 'HEAD' });
      const contentLength = response.headers.get('Content-Length');
      return contentLength ? parseInt(contentLength, 10) : null;
    } catch {
      return null;
    }
  }

  async startDownload(onProgress: ProgressCallback): Promise<void> {
    this._error = null;
    this._status = 'downloading';

    await this._ensureModelDir();

    try {
      // 1. Resolve redirect and check content
      const headResponse = await fetch(MODEL_DOWNLOAD_URL, { method: 'HEAD' });
      const finalUrl = headResponse.url;
      const contentType = headResponse.headers.get('Content-Type');

      if (contentType?.includes('text/html')) {
        throw new Error('The download URL returned an HTML page instead of a model file. The link might be expired or restricted.');
      }

      // 2. Clear any existing corrupted file
      const info = await FileSystem.getInfoAsync(MODEL_LOCAL_PATH);
      if (info.exists) {
        await FileSystem.deleteAsync(MODEL_LOCAL_PATH, { idempotent: true });
      }

      // 3. Start the actual download using the resolved URL
      this.downloadResumable = FileSystem.createDownloadResumable(
        finalUrl,
        MODEL_LOCAL_PATH,
        {},
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
        const finalInfo = await FileSystem.getInfoAsync(MODEL_LOCAL_PATH);
        const actualSize = finalInfo.exists ? (finalInfo.size ?? 0) : 0;
        const MIN_SIZE = 100 * 1024 * 1024;

        if (actualSize > MIN_SIZE) {
          this._status = 'done';
          console.log(`[ModelDownloadService] Download successful: ${actualSize} bytes`);
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
        await FileSystem.deleteAsync(MODEL_LOCAL_PATH, { idempotent: true });
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
    const info = await FileSystem.getInfoAsync(MODEL_LOCAL_PATH);
    if (info.exists) {
      await FileSystem.deleteAsync(MODEL_LOCAL_PATH, { idempotent: true });
    }
    this._status = 'idle';
    this._error = null;
    await this.startDownload(onProgress);
  }

  async deleteModel(): Promise<void> {
    await FileSystem.deleteAsync(MODEL_LOCAL_PATH, { idempotent: true });
    this.downloadResumable = null;
    this._status = 'idle';
  }

  private async _ensureModelDir(): Promise<void> {
    const dirInfo = await FileSystem.getInfoAsync(MODEL_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true });
    }
  }
}

export const modelDownloadService = new ModelDownloadService();
