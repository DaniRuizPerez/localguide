import type { GPSContext, InferenceOptions } from '../services/InferenceService';
import type { DownloadStatus, DownloadProgress } from '../services/ModelDownloadService';
import type { AutoGuideCallback, AutoGuideEvent } from '../services/AutoGuideService';
import type { GuideResponse } from '../services/LocalGuideService';

export type { GPSContext, InferenceOptions };
export type { DownloadStatus, DownloadProgress };
export type { AutoGuideCallback, AutoGuideEvent };
export type { GuideResponse };

export interface IInferenceService {
  initialize(): Promise<void>;
  runInference(prompt: string, options?: InferenceOptions): Promise<string>;
  dispose(): Promise<void>;
  readonly isLoaded: boolean;
}

export interface ISpeechService {
  speak(text: string): Promise<void>;
  stop(): void;
  readonly isSpeaking: boolean;
}

export interface IVoiceRecognitionService {
  requestPermission(): Promise<boolean>;
  start(): void;
  stop(): void;
  abort(): void;
  isAvailable(): Promise<boolean>;
}

export interface ILocalGuideService {
  initialize(): Promise<void>;
  ask(userQuery: string, gps: GPSContext): Promise<GuideResponse>;
  dispose(): Promise<void>;
}

export interface IModelDownloadService {
  readonly status: DownloadStatus;
  readonly error: string | null;
  isModelDownloaded(): Promise<boolean>;
  getRemoteFileSize(): Promise<number | null>;
  startDownload(onProgress: (p: DownloadProgress) => void): Promise<void>;
  pauseDownload(): Promise<void>;
  resumeDownload(onProgress: (p: DownloadProgress) => void): Promise<void>;
  retryDownload(onProgress: (p: DownloadProgress) => void): Promise<void>;
  deleteModel(): Promise<void>;
}

export interface IAutoGuideService {
  addListener(cb: AutoGuideCallback): void;
  removeListener(cb: AutoGuideCallback): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly isRunning: boolean;
}
