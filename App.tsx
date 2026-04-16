import React, { useEffect, useState, Component, type ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AppNavigator from './src/navigation/AppNavigator';
import ModelDownloadScreen from './src/screens/ModelDownloadScreen';
import { modelDownloadService } from './src/services/ModelDownloadService';

type AppState = 'checking' | 'needs_download' | 'ready';

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorMessage}>{this.state.error.message}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

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
    <ErrorBoundary>
      <AppNavigator />
      <StatusBar style="auto" />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#F2F2F7',
  },
  errorTitle: { fontSize: 18, fontWeight: '600', color: '#1C1C1E', marginBottom: 8 },
  errorMessage: { fontSize: 14, color: '#8E8E93', textAlign: 'center' },
});
