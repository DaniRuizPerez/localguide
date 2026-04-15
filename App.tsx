import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import AppNavigator from './src/navigation/AppNavigator';
import ModelDownloadScreen from './src/screens/ModelDownloadScreen';
import { modelDownloadService } from './src/services/ModelDownloadService';

type AppState = 'checking' | 'needs_download' | 'ready';

export default function App() {
  const [appState, setAppState] = useState<AppState>('checking');

  useEffect(() => {
    modelDownloadService.isModelDownloaded().then((downloaded) => {
      setAppState(downloaded ? 'ready' : 'needs_download');
    });
  }, []);

  if (appState === 'checking') {
    return null; // splash screen covers this briefly
  }

  if (appState === 'needs_download') {
    return (
      <>
        <ModelDownloadScreen onDownloadComplete={() => setAppState('ready')} />
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
