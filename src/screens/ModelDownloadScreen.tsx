import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import {
  modelDownloadService,
  DownloadProgress,
  MODEL_DOWNLOAD_URL,
} from '../services/ModelDownloadService';

interface Props {
  onDownloadComplete: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function ModelDownloadScreen({ onDownloadComplete }: Props) {
  const [remoteSize, setRemoteSize] = useState<number | null>(null);
  const [progress, setProgress] = useState<DownloadProgress>({
    bytesDownloaded: 0,
    bytesTotal: 0,
    fraction: 0,
  });
  const [downloadStatus, setDownloadStatus] = useState<
    'idle' | 'downloading' | 'paused' | 'done' | 'error'
  >('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fetchingSize, setFetchingSize] = useState(false);

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

  const handleStart = useCallback(async () => {
    setErrorMessage(null);
    setDownloadStatus('downloading');
    try {
      await modelDownloadService.startDownload(handleProgress);
      setDownloadStatus('done');
      onDownloadComplete();
    } catch (err) {
      setDownloadStatus('error');
      setErrorMessage(
        modelDownloadService.error ?? (err instanceof Error ? err.message : String(err))
      );
    }
  }, [handleProgress, onDownloadComplete]);

  const handlePause = useCallback(async () => {
    await modelDownloadService.pauseDownload();
    setDownloadStatus('paused');
  }, []);

  const handleResume = useCallback(async () => {
    setDownloadStatus('downloading');
    setErrorMessage(null);
    try {
      await modelDownloadService.resumeDownload(handleProgress);
      setDownloadStatus('done');
      onDownloadComplete();
    } catch (err) {
      setDownloadStatus('error');
      setErrorMessage(
        modelDownloadService.error ?? (err instanceof Error ? err.message : String(err))
      );
    }
  }, [handleProgress, onDownloadComplete]);

  const handleRetry = useCallback(async () => {
    setErrorMessage(null);
    setProgress({ bytesDownloaded: 0, bytesTotal: 0, fraction: 0 });
    setDownloadStatus('downloading');
    try {
      await modelDownloadService.retryDownload(handleProgress);
      setDownloadStatus('done');
      onDownloadComplete();
    } catch (err) {
      setDownloadStatus('error');
      setErrorMessage(
        modelDownloadService.error ?? (err instanceof Error ? err.message : String(err))
      );
    }
  }, [handleProgress, onDownloadComplete]);

  const progressPercent = Math.round(progress.fraction * 100);
  const isActive = downloadStatus === 'downloading';
  const isPaused = downloadStatus === 'paused';
  const isError = downloadStatus === 'error';
  const isIdle = downloadStatus === 'idle';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Gemma Model Required</Text>
      <Text style={styles.subtitle}>
        The on-device AI model must be downloaded before you can use Local Guide.
      </Text>

      <View style={styles.infoBox}>
        <Text style={styles.infoLabel}>Model</Text>
        <Text style={styles.infoValue}>Gemma 3 1B IT (INT4)</Text>

        <Text style={styles.infoLabel}>Storage Required</Text>
        {fetchingSize ? (
          <ActivityIndicator size="small" color="#007AFF" />
        ) : (
          <Text style={styles.infoValue}>
            {remoteSize != null ? formatBytes(remoteSize) : 'Unknown'}
          </Text>
        )}

        <Text style={styles.infoLabel}>Source</Text>
        <Text style={styles.infoValueSmall} numberOfLines={1}>
          {MODEL_DOWNLOAD_URL}
        </Text>
      </View>

      {(isActive || isPaused) && (
        <View style={styles.progressContainer}>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
          </View>
          <Text style={styles.progressText}>
            {formatBytes(progress.bytesDownloaded)}
            {progress.bytesTotal > 0 ? ` / ${formatBytes(progress.bytesTotal)}` : ''}
            {'  '}
            {progressPercent}%
          </Text>
        </View>
      )}

      {isError && errorMessage && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      )}

      <View style={styles.buttonRow}>
        {isIdle && (
          <TouchableOpacity style={styles.primaryButton} onPress={handleStart}>
            <Text style={styles.primaryButtonText}>Download</Text>
          </TouchableOpacity>
        )}

        {isActive && (
          <TouchableOpacity style={styles.secondaryButton} onPress={handlePause}>
            <Text style={styles.secondaryButtonText}>Pause</Text>
          </TouchableOpacity>
        )}

        {isPaused && (
          <TouchableOpacity style={styles.primaryButton} onPress={handleResume}>
            <Text style={styles.primaryButtonText}>Resume</Text>
          </TouchableOpacity>
        )}

        {isError && (
          <TouchableOpacity style={styles.primaryButton} onPress={handleRetry}>
            <Text style={styles.primaryButtonText}>Retry</Text>
          </TouchableOpacity>
        )}

        {isActive && (
          <ActivityIndicator
            size="small"
            color="#007AFF"
            style={styles.spinner}
          />
        )}
      </View>

      {Platform.OS === 'android' && (
        <Text style={styles.platformNote}>
          Wi-Fi recommended — model may be several hundred MB.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    backgroundColor: '#F2F2F7',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1C1C1E',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#3C3C43',
    marginBottom: 24,
    lineHeight: 22,
  },
  infoBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    gap: 4,
  },
  infoLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8E8E93',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
  },
  infoValue: {
    fontSize: 15,
    color: '#1C1C1E',
    fontWeight: '500',
  },
  infoValueSmall: {
    fontSize: 12,
    color: '#3C3C43',
  },
  progressContainer: {
    marginBottom: 20,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: '#E5E5EA',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#007AFF',
    borderRadius: 4,
  },
  progressText: {
    fontSize: 13,
    color: '#3C3C43',
    textAlign: 'right',
  },
  errorBox: {
    backgroundColor: '#FFE5E5',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#D70015',
    fontSize: 13,
    lineHeight: 18,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  primaryButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#E5E5EA',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  secondaryButtonText: {
    color: '#1C1C1E',
    fontSize: 17,
    fontWeight: '600',
  },
  spinner: {
    marginLeft: 8,
  },
  platformNote: {
    marginTop: 16,
    fontSize: 12,
    color: '#8E8E93',
    textAlign: 'center',
  },
});
