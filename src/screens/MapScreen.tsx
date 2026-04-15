import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { RootTabParamList } from '../navigation/AppNavigator';
import { useLocation } from '../hooks/useLocation';

type Props = BottomTabScreenProps<RootTabParamList, 'Map'>;

export default function MapScreen(_props: Props) {
  const { gps, status, errorMessage, refresh } = useLocation();

  return (
    <View style={styles.container}>
      {status === 'requesting' && (
        <View style={styles.centeredBlock}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Getting your location…</Text>
        </View>
      )}

      {(status === 'denied' || status === 'error') && (
        <View style={styles.centeredBlock}>
          <Text style={styles.errorIcon}>📍</Text>
          <Text style={styles.errorText}>{errorMessage ?? 'Location unavailable'}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={refresh}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {status === 'ready' && gps && (
        <View style={styles.coordsCard}>
          <Text style={styles.coordsLabel}>Current Location</Text>
          <Text style={styles.coordsValue}>
            {gps.latitude.toFixed(6)}°N
          </Text>
          <Text style={styles.coordsValue}>
            {gps.longitude.toFixed(6)}°E
          </Text>
          {gps.accuracy != null && (
            <Text style={styles.coordsAccuracy}>Accuracy: ±{Math.round(gps.accuracy)}m</Text>
          )}
          <TouchableOpacity style={styles.refreshBtn} onPress={refresh}>
            <Text style={styles.refreshBtnText}>↻ Refresh</Text>
          </TouchableOpacity>
          <Text style={styles.mapNote}>
            Full map view available after native build.{'\n'}
            Switch to the Chat tab to explore nearby places.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  centeredBlock: { alignItems: 'center', gap: 12 },
  loadingText: { color: '#6C6C70', fontSize: 16 },
  errorIcon: { fontSize: 48 },
  errorText: { color: '#C62828', fontSize: 15, textAlign: 'center' },
  retryBtn: {
    marginTop: 8,
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryBtnText: { color: '#FFF', fontWeight: '600' },
  coordsCard: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    width: '100%',
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  coordsLabel: { fontSize: 13, color: '#8E8E93', fontWeight: '500', textTransform: 'uppercase' },
  coordsValue: { fontSize: 28, fontWeight: '700', color: '#1C1C1E', letterSpacing: 0.5 },
  coordsAccuracy: { fontSize: 13, color: '#8E8E93' },
  refreshBtn: {
    marginTop: 4,
    backgroundColor: '#F2F2F7',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 10,
  },
  refreshBtnText: { color: '#007AFF', fontWeight: '600' },
  mapNote: {
    marginTop: 12,
    fontSize: 12,
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 18,
  },
});
