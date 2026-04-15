import * as FileSystem from 'expo-file-system';

export const MODEL_DOWNLOAD_URL =
  'https://storage.googleapis.com/mediapipe-models/llm_inference/gemma3/int4/gemma3-1b-it-int4.task';

export const MODEL_FILE_NAME = 'gemma3-1b-it-int4.task';
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

    this.downloadResumable = FileSystem.createDownloadResumable(
      MODEL_DOWNLOAD_URL,
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

    try {
      const result = await this.downloadResumable.downloadAsync();
      if (result && result.status === 200) {
        this._status = 'done';
      } else {
        this._status = 'error';
        this._error = `Download failed with status ${result?.status ?? 'unknown'}`;
      }
    } catch (err) {
      this._status = 'error';
      this._error = err instanceof Error ? err.message : String(err);
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
