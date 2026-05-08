import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, Fraunces_500Medium } from '@expo-google-fonts/fraunces';
import {
  Nunito_400Regular,
  Nunito_500Medium,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
} from '@expo-google-fonts/nunito';
import AppNavigator from './src/navigation/AppNavigator';
import ModelDownloadScreen from './src/screens/ModelDownloadScreen';
import { modelDownloadService, profileForTier } from './src/services/ModelDownloadService';
import { inferenceService } from './src/services/InferenceService';
import { GuideAvatar } from './src/components/GuideAvatar';
import { Colors } from './src/theme/colors';
import { Type } from './src/theme/tokens';
import { t } from './src/i18n';
import { narrationPrefs } from './src/services/NarrationPrefs';
import { guidePrefs } from './src/services/GuidePrefs';
import { networkStatus } from './src/services/NetworkStatus';
import { breadcrumbTrail } from './src/services/BreadcrumbTrail';
import { visitedStore } from './src/services/VisitedStore';
import { speechBackgroundKeeper } from './src/services/SpeechBackgroundKeeper';
import { WelcomeTour } from './src/components/WelcomeTour';
import { OfflineDimOverlay } from './src/components/OfflineDimOverlay';

type AppState = 'checking' | 'needs_download' | 'warming_up' | 'ready';

export default function App() {
  const [appState, setAppState] = useState<AppState>('checking');
  const [warmupError, setWarmupError] = useState<string | null>(null);
  const [warmupRetryCount, setWarmupRetryCount] = useState(0);
  const [fontsLoaded] = useFonts({
    Fraunces_500Medium,
    Nunito_400Regular,
    Nunito_500Medium,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
  });

  useEffect(() => {
    // Hydrate persisted narration preferences (length, voice, rate) in parallel
    // with the model boot-up checks below — cheap async, can't fail in a way
    // that blocks the app.
    narrationPrefs.hydrate();
    guidePrefs.hydrate();
    networkStatus.init();
    breadcrumbTrail.hydrate();
    visitedStore.hydrate();
    // Holds a wake-lock while narration is active so backgrounding the phone
    // doesn't stall the speech queue (C3).
    return speechBackgroundKeeper.install();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await inferenceService.getDeviceTier();
        const tier = info?.tier ?? 'mid';
        modelDownloadService.setActiveProfile(profileForTier(tier));
      } catch {
        // getDeviceTier is best-effort; leave the default profile.
      }
      if (cancelled) return;
      const downloaded = await modelDownloadService.isModelDownloaded();
      if (cancelled) return;
      if (downloaded) {
        modelDownloadService.cleanupOtherProfiles().catch(() => {});
      }
      setAppState(downloaded ? 'warming_up' : 'needs_download');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (appState !== 'warming_up') return;
    let cancelled = false;
    inferenceService
      .initialize()
      .then(() => {
        if (!cancelled) setAppState('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setWarmupError(msg);
      });
    return () => {
      cancelled = true;
    };
    // warmupRetryCount is added so that retrying (which bumps the counter
    // while keeping appState === 'warming_up') re-runs this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState, warmupRetryCount]);

  if (!fontsLoaded || appState === 'checking') {
    return null; // splash screen covers this briefly
  }

  if (appState === 'needs_download') {
    return (
      <SafeAreaProvider>
        <ModelDownloadScreen onDownloadComplete={() => setAppState('warming_up')} />
        <StatusBar style="dark" />
      </SafeAreaProvider>
    );
  }

  if (appState === 'warming_up') {
    return (
      <SafeAreaProvider>
        <View style={styles.loadingContainer}>
          <GuideAvatar size={64} />
          <ActivityIndicator size="large" color={Colors.primary} style={styles.spinner} />
          <Text style={styles.title}>{t('app.warmupTitle')}</Text>
          <Text style={styles.subtitle}>{t('app.warmupSubtitle')}</Text>

          <Text style={styles.hallucinationWarning}>{t('app.hallucinationWarning')}</Text>

          {warmupError && (
            <>
              <Text style={styles.errorText}>{t('app.warmupError', { message: warmupError })}</Text>
              <TouchableOpacity
                style={styles.retryBtn}
                onPress={() => {
                  setWarmupError(null);
                  setWarmupRetryCount((c) => c + 1);
                }}
                accessibilityRole="button"
              >
                <Text style={styles.retryBtnText}>{t('app.warmupRetry')}</Text>
              </TouchableOpacity>
              {warmupRetryCount >= 3 && (
                <TouchableOpacity
                  style={[styles.retryBtn, styles.redownloadBtn]}
                  onPress={async () => {
                    await modelDownloadService.deleteModel().catch(() => {});
                    setWarmupError(null);
                    setWarmupRetryCount(0);
                    setAppState('needs_download');
                  }}
                  accessibilityRole="button"
                >
                  <Text style={[styles.retryBtnText, styles.redownloadBtnText]}>
                    {t('app.warmupRedownload')}
                  </Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
        <StatusBar style="dark" />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <AppNavigator initialTopic={undefined} />
      {/* Warm-brown tint that fades in over the whole app when effective
          mode is 'offline' — gives the cream UI a dim, dark-mode-adjacent
          feel without migrating every StyleSheet.create to a hook.
          pointerEvents="none". */}
      <OfflineDimOverlay />
      {/* One-time welcome tour — rendered as an absolute overlay above the nav.
          WelcomeTour manages its own AsyncStorage check internally and returns
          null when the tour has already been seen, so no extra state is needed. */}
      <WelcomeTour onDismiss={() => {}} />
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  spinner: { marginTop: 24, marginBottom: 20 },
  title: {
    ...Type.title,
    color: Colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    ...Type.body,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  hallucinationWarning: {
    ...Type.bodySm,
    color: '#8A4B00',
    backgroundColor: '#FBEBD0',
    borderWidth: 1,
    borderColor: '#F4C27A',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 20,
    textAlign: 'center',
  },
  errorText: {
    ...Type.bodySm,
    marginTop: 20,
    color: Colors.error,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 14,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
  },
  retryBtnText: {
    ...Type.title,
    color: '#FFFFFF',
  },
  redownloadBtn: {
    marginTop: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  redownloadBtnText: {
    color: Colors.text,
  },
});
