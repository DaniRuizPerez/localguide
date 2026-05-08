import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Alert, BackHandler, Linking, View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Network from 'expo-network';
import {
  modelDownloadService,
  DownloadProgress,
} from '../services/ModelDownloadService';
import { Colors } from '../theme/colors';
import { Type, Radii, Spacing } from '../theme/tokens';
import { ProgressOrb } from '../components/ProgressOrb';
import { PillowChip } from '../components/PillowChip';
import { SoftButton } from '../components/SoftButton';
import { Wordmark } from '../components/Wordmark';
import { t } from '../i18n';

interface Props {
  onDownloadComplete: () => void;
}

function formatMb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

export default function ModelDownloadScreen({ onDownloadComplete }: Props) {
  const [remoteSize, setRemoteSize] = useState<number | null>(null);
  const [progress, setProgress] = useState<DownloadProgress>({
    bytesDownloaded: 0,
    bytesTotal: 0,
    fraction: 0,
  });
  const [downloadStatus, setDownloadStatus] = useState<
    'idle' | 'downloading' | 'paused' | 'done' | 'error' | 'cellular-warning'
  >('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Subscription ref so we can cancel the Wi-Fi listener if the user navigates away.
  const networkListenerRef = useRef<ReturnType<typeof Network.addNetworkStateListener> | null>(null);

  useEffect(() => {
    modelDownloadService.getRemoteFileSize().then((size) => setRemoteSize(size));
    return () => {
      networkListenerRef.current?.remove();
    };
  }, []);

  const handleProgress = useCallback((p: DownloadProgress) => {
    setProgress(p);
  }, []);

  /** Actually run the download (called after any cellular gate is cleared). */
  const runDownload = useCallback(async () => {
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

  /** Subscribe to network changes and resume when Wi-Fi is back. */
  const waitForWifi = useCallback(() => {
    setDownloadStatus('idle');
    networkListenerRef.current?.remove();
    networkListenerRef.current = Network.addNetworkStateListener((state) => {
      if (
        state.type === Network.NetworkStateType.WIFI ||
        state.type === Network.NetworkStateType.ETHERNET
      ) {
        networkListenerRef.current?.remove();
        networkListenerRef.current = null;
        runDownload();
      }
    });
  }, [runDownload]);

  const handleStart = useCallback(async () => {
    setErrorMessage(null);
    try {
      const isCellular = await modelDownloadService.checkCellular();
      if (isCellular) {
        setDownloadStatus('cellular-warning');
        Alert.alert(
          'Mobile data',
          t('download.cellularWarning'),
          [
            {
              text: t('download.cellularWait'),
              onPress: waitForWifi,
            },
            {
              text: t('download.cellularContinue'),
              style: 'default',
              onPress: runDownload,
            },
          ]
        );
        return;
      }
    } catch {
      // checkCellular already set status=error if no connection
      setDownloadStatus('error');
      setErrorMessage(modelDownloadService.error ?? 'No internet connection.');
      return;
    }
    await runDownload();
  }, [runDownload, waitForWifi]);

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

  const handleCancelAndExit = useCallback(() => {
    Alert.alert(
      t('download.cancel') ?? 'Cancel download',
      'Quit the app? You can come back later.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Quit', onPress: () => BackHandler.exitApp() },
      ]
    );
  }, []);

  const percent = Math.round(progress.fraction * 100);
  const downloadedMb = formatMb(progress.bytesDownloaded);
  const totalMb = remoteSize != null
    ? formatMb(remoteSize)
    : progress.bytesTotal > 0
    ? formatMb(progress.bytesTotal)
    : modelDownloadService.profile.approximateSizeMb;

  const isActive = downloadStatus === 'downloading';
  const isPaused = downloadStatus === 'paused';
  const isError = downloadStatus === 'error';
  const isIdle = downloadStatus === 'idle' || downloadStatus === 'cellular-warning';
  const isDone = downloadStatus === 'done';

  const orbState: 'downloading' | 'paused' | 'complete' | 'error' | 'idle' = isError
    ? 'error'
    : isDone
    ? 'complete'
    : isActive
    ? 'downloading'
    : isPaused
    ? 'paused'
    : 'idle';

  const primaryLabel = isError
    ? t('download.retry')
    : isDone
    ? t('download.startExploring')
    : isActive
    ? t('download.pause')
    : isPaused
    ? t('download.resume')
    : t('download.start');
  const primaryAction = isError
    ? handleRetry
    : isDone
    ? onDownloadComplete
    : isActive
    ? handlePause
    : isPaused
    ? handleResume
    : handleStart;

  // Show the Cancel & exit button when paused or idle (not yet started or paused mid-way).
  const showCancelExit = isPaused || isIdle;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.container} bounces={false}>
        <Wordmark />

        <View style={styles.headingBlock}>
          <Text style={[Type.h1, { color: Colors.text }]}>{t('download.heading')}</Text>
          <Text style={[Type.body, { color: Colors.textSecondary, marginTop: 10 }]}>
            {t('download.subtitle')}
          </Text>
        </View>

        <View style={styles.orbWrap}>
          <ProgressOrb
            percent={percent}
            label={`${downloadedMb} of ${totalMb} MB`}
            state={orbState}
          />
        </View>

        <View style={styles.chipsRow}>
          <PillowChip label={modelDownloadService.profile.displayName.split(' ').slice(0, 2).join(' ')} />
          <PillowChip label={t('download.optimizedChip')} />
          <PillowChip label={t('download.wifiOnlyChip')} />
        </View>

        {isError && errorMessage ? (
          <View style={styles.errorBox}>
            <Text style={[Type.bodySm, { color: Colors.error }]}>{errorMessage}</Text>
          </View>
        ) : null}

        <View style={styles.ctaWrap}>
          <SoftButton
            label={primaryLabel}
            onPress={primaryAction}
            variant="primary"
            size="lg"
          />
          {showCancelExit ? (
            <SoftButton
              label={t('download.cancel')}
              onPress={handleCancelAndExit}
              variant="secondary"
              size="lg"
            />
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 28,
  },
  headingBlock: {
    marginTop: 26,
  },
  orbWrap: {
    alignItems: 'center',
    marginTop: 28,
    marginBottom: 18,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginBottom: Spacing.lg,
    flexWrap: 'wrap',
  },
  errorBox: {
    backgroundColor: Colors.errorLight,
    borderRadius: Radii.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#F3C4C4',
    marginBottom: Spacing.md,
  },
  ctaWrap: {
    marginTop: 'auto',
    paddingTop: Spacing.lg,
    gap: Spacing.sm,
  },
});
