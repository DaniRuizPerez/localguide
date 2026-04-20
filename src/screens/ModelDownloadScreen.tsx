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
} from '../services/ModelDownloadService';
import { Colors } from '../theme/colors';

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
      <View style={styles.logoRow}>
        <Text style={styles.logoEmoji}>🧭</Text>
        <Text style={styles.logoTitle}>Local Guide</Text>
      </View>

      <Text style={styles.title}>Download AI Model</Text>
      <Text style={styles.subtitle}>
        The on-device AI model must be downloaded before you can use Local Guide.
        Your conversations stay private — all inference runs on your device.
      </Text>

      <View style={styles.infoBox}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Model</Text>
          <Text style={styles.infoValue}>{modelDownloadService.profile.displayName}</Text>
        </View>
        <View style={styles.infoDivider} />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Storage Required</Text>
          {fetchingSize ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <Text style={styles.infoValue}>
              {remoteSize != null
                ? formatBytes(remoteSize)
                : `~${modelDownloadService.profile.approximateSizeMb} MB`}
            </Text>
          )}
        </View>
        <View style={styles.infoDivider} />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Source</Text>
          <Text style={styles.infoValueSmall} numberOfLines={1}>
            {modelDownloadService.profile.url}
          </Text>
        </View>
      </View>

      {(isActive || isPaused) && (
        <View style={styles.progressContainer}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressLabel}>Downloading…</Text>
            <Text style={styles.progressPercent}>{progressPercent}%</Text>
          </View>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${progressPercent}%` as any }]} />
          </View>
          <Text style={styles.progressBytes}>
            {formatBytes(progress.bytesDownloaded)}
            {progress.bytesTotal > 0 ? ` of ${formatBytes(progress.bytesTotal)}` : ''}
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
            <Text style={styles.primaryButtonText}>Download Model</Text>
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
            <Text style={styles.primaryButtonText}>Retry Download</Text>
          </TouchableOpacity>
        )}

        {isActive && (
          <ActivityIndicator
            size="small"
            color={Colors.primary}
            style={styles.spinner}
          />
        )}
      </View>

      {Platform.OS === 'android' && (
        <Text style={styles.platformNote}>
          📶 Wi-Fi recommended — model may be several hundred MB.
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
    backgroundColor: Colors.background,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 28,
  },
  logoEmoji: { fontSize: 36, marginRight: 10 },
  logoTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.primary,
    letterSpacing: -0.5,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 24,
    lineHeight: 20,
  },
  infoBox: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  infoDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.borderLight,
  },
  infoLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 14,
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  infoValueSmall: {
    fontSize: 11,
    color: Colors.textSecondary,
    maxWidth: '60%',
    textAlign: 'right',
  },
  progressContainer: {
    marginBottom: 20,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  progressLabel: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  progressPercent: { fontSize: 13, color: Colors.primary, fontWeight: '700' },
  progressBarBg: {
    height: 8,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 4,
  },
  progressBytes: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  errorBox: {
    backgroundColor: Colors.errorLight,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorText: {
    color: Colors.error,
    fontSize: 13,
    lineHeight: 18,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  primaryButton: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 28,
    shadowColor: Colors.primary,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  primaryButtonText: {
    color: Colors.surface,
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 28,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  secondaryButtonText: {
    color: Colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  spinner: {
    marginLeft: 8,
  },
  platformNote: {
    marginTop: 20,
    fontSize: 12,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
});
