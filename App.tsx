import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AppNavigator from './src/navigation/AppNavigator';
import ModelDownloadScreen from './src/screens/ModelDownloadScreen';
import { modelDownloadService } from './src/services/ModelDownloadService';
import { inferenceService } from './src/services/InferenceService';
import { Colors } from './src/theme/colors';

type AppState = 'checking' | 'needs_download' | 'warming_up' | 'ready';

export default function App() {
  const [appState, setAppState] = useState<AppState>('checking');
  const [warmupError, setWarmupError] = useState<string | null>(null);

  useEffect(() => {
    modelDownloadService.isModelDownloaded().then((downloaded) => {
      setAppState(downloaded ? 'warming_up' : 'needs_download');
    });
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

  if (appState === 'checking') {
    return null; // splash screen covers this briefly
  }

  if (appState === 'needs_download') {
    return (
      <>
        <ModelDownloadScreen onDownloadComplete={() => setAppState('warming_up')} />
        <StatusBar style="auto" />
      </>
    );
  }

  if (appState === 'warming_up') {
    return (
      <>
        <View style={styles.loadingContainer}>
          <Text style={styles.emoji}>🧭</Text>
          <ActivityIndicator size="large" color={Colors.primary} style={styles.spinner} />
          <Text style={styles.title}>Getting your guide ready…</Text>
          <Text style={styles.subtitle}>
            Loading the on-device model and warming up so your first question is fast.
            {'\n'}
            This happens once per app launch.
          </Text>
          {warmupError && (
            <Text style={styles.errorText}>Warmup error: {warmupError}</Text>
          )}
        </View>
        <StatusBar style="auto" />
      </>
    );
  }

  return (
    <>
      <AppNavigator />
      <StatusBar style="auto" />
    </>
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
  emoji: { fontSize: 56, marginBottom: 16 },
  spinner: { marginBottom: 20 },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  errorText: {
    marginTop: 20,
    color: Colors.error ?? '#d33',
    fontSize: 13,
    textAlign: 'center',
  },
});
