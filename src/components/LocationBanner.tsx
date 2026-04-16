import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import type { GPSContext } from '../services/InferenceService';

interface Props {
  status: string;
  gps: GPSContext | null;
  errorMessage: string | null;
  onRefresh: () => void;
}

export function LocationBanner({ status, gps, errorMessage, onRefresh }: Props) {
  if (status === 'ready' && gps) {
    return (
      <View style={styles.ready}>
        <Text style={styles.text}>
          📍 {gps.latitude.toFixed(4)}, {gps.longitude.toFixed(4)}
          {gps.accuracy != null ? `  ±${Math.round(gps.accuracy)}m` : ''}
        </Text>
      </View>
    );
  }
  if (status === 'requesting') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color="#007AFF" />
        <Text style={[styles.text, { marginLeft: 6 }]}>Getting location…</Text>
      </View>
    );
  }
  if (status === 'denied' || status === 'error') {
    return (
      <TouchableOpacity style={styles.error} onPress={onRefresh}>
        <Text style={styles.errorText}>{errorMessage ?? 'Location unavailable'} — tap to retry</Text>
      </TouchableOpacity>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  ready: {
    backgroundColor: '#E8F5E9',
    paddingVertical: 6,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  loading: {
    backgroundColor: '#E3F2FD',
    paddingVertical: 6,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  error: {
    backgroundColor: '#FFEBEE',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  text: { fontSize: 12, color: '#2E7D32' },
  errorText: { fontSize: 12, color: '#C62828' },
});
