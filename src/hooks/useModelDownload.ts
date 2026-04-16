import { useState, useEffect, useCallback } from 'react';
import {
  modelDownloadService,
  type DownloadStatus,
  type DownloadProgress,
} from '../services/ModelDownloadService';

export interface ModelDownloadState {
  status: DownloadStatus;
  progress: DownloadProgress;
  remoteSize: number | null;
  fetchingSize: boolean;
  errorMessage: string | null;
  start: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  retry: () => Promise<void>;
}

const INITIAL_PROGRESS: DownloadProgress = { bytesDownloaded: 0, bytesTotal: 0, fraction: 0 };

export function useModelDownload(onComplete?: () => void): ModelDownloadState {
  const [status, setStatus] = useState<DownloadStatus>('idle');
  const [progress, setProgress] = useState<DownloadProgress>(INITIAL_PROGRESS);
  const [remoteSize, setRemoteSize] = useState<number | null>(null);
  const [fetchingSize, setFetchingSize] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setFetchingSize(true);
    modelDownloadService
      .getRemoteFileSize()
      .then((size) => setRemoteSize(size))
      .finally(() => setFetchingSize(false));
  }, []);

  const handleProgress = useCallback((p: DownloadProgress) => {
    setProgress(p);
  }, []);

  const resolveError = (err: unknown) =>
    modelDownloadService.error ?? (err instanceof Error ? err.message : String(err));

  const start = useCallback(async () => {
    setErrorMessage(null);
    setStatus('downloading');
    try {
      await modelDownloadService.startDownload(handleProgress);
      setStatus('done');
      onComplete?.();
    } catch (err) {
      setStatus('error');
      setErrorMessage(resolveError(err));
    }
  }, [handleProgress, onComplete]);

  const pause = useCallback(async () => {
    await modelDownloadService.pauseDownload();
    setStatus('paused');
  }, []);

  const resume = useCallback(async () => {
    setStatus('downloading');
    setErrorMessage(null);
    try {
      await modelDownloadService.resumeDownload(handleProgress);
      setStatus('done');
      onComplete?.();
    } catch (err) {
      setStatus('error');
      setErrorMessage(resolveError(err));
    }
  }, [handleProgress, onComplete]);

  const retry = useCallback(async () => {
    setErrorMessage(null);
    setProgress(INITIAL_PROGRESS);
    setStatus('downloading');
    try {
      await modelDownloadService.retryDownload(handleProgress);
      setStatus('done');
      onComplete?.();
    } catch (err) {
      setStatus('error');
      setErrorMessage(resolveError(err));
    }
  }, [handleProgress, onComplete]);

  return { status, progress, remoteSize, fetchingSize, errorMessage, start, pause, resume, retry };
}
