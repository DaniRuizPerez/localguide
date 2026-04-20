import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
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
import { TopicChips, type GuideTopic } from './src/components/TopicChips';
import { GuideAvatar } from './src/components/GuideAvatar';
import { Colors } from './src/theme/colors';
import { Type } from './src/theme/tokens';
import { t } from './src/i18n';

type AppState = 'checking' | 'needs_download' | 'warming_up' | 'ready';

export default function App() {
  const [appState, setAppState] = useState<AppState>('checking');
  const [warmupError, setWarmupError] = useState<string | null>(null);
  const [topic, setTopic] = useState<GuideTopic>('everything');

  const [fontsLoaded] = useFonts({
    Fraunces_500Medium,
    Nunito_400Regular,
    Nunito_500Medium,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
  });

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
  }, [appState]);

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

          <Text style={styles.topicsHeading}>{t('app.pickTopic')}</Text>
          <TopicChips selected={topic} onSelect={setTopic} />

          {warmupError && (
            <Text style={styles.errorText}>{t('app.warmupError', { message: warmupError })}</Text>
          )}
        </View>
        <StatusBar style="dark" />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <AppNavigator initialTopic={topic} />
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
  topicsHeading: {
    ...Type.metaUpper,
    marginTop: 32,
    marginBottom: 8,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  errorText: {
    ...Type.bodySm,
    marginTop: 20,
    color: Colors.error,
    textAlign: 'center',
  },
});
