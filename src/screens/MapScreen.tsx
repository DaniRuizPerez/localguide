import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { RootTabParamList } from '../navigation/AppNavigator';
import { useLocation } from '../hooks/useLocation';
import { Colors } from '../theme/colors';

type Props = BottomTabScreenProps<RootTabParamList, 'Map'>;

export default function MapScreen(_props: Props) {
  const { gps, status, errorMessage, refresh } = useLocation();

  return (
    <View style={styles.container}>
      {status === 'requesting' && (
        <View style={styles.centeredBlock}>
          <ActivityIndicator size="large" color={Colors.primary} />
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
          <View style={styles.coordsIconRow}>
            <Text style={styles.coordsIcon}>📍</Text>
          </View>
          <Text style={styles.coordsLabel}>Current Location</Text>
          <Text style={styles.coordsValue}>
            {gps.latitude.toFixed(6)}°N
          </Text>
          <Text style={styles.coordsValue}>
            {gps.longitude.toFixed(6)}°E
          </Text>
          {gps.accuracy != null && (
            <View style={styles.accuracyBadge}>
              <Text style={styles.accuracyText}>±{Math.round(gps.accuracy)}m accuracy</Text>
            </View>
          )}
          <TouchableOpacity style={styles.refreshBtn} onPress={refresh}>
            <Text style={styles.refreshBtnText}>↻  Refresh</Text>
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
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  centeredBlock: { alignItems: 'center', gap: 12 },
  loadingText: { color: Colors.textSecondary, fontSize: 16 },
  errorIcon: { fontSize: 48 },
  errorText: { color: Colors.error, fontSize: 15, textAlign: 'center' },
  retryBtn: {
    marginTop: 8,
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 12,
    shadowColor: Colors.primary,
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  retryBtnText: { color: Colors.surface, fontWeight: '600', fontSize: 15 },
  coordsCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    width: '100%',
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  coordsIconRow: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  coordsIcon: { fontSize: 28 },
  coordsLabel: {
    fontSize: 12,
    color: Colors.textTertiary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  coordsValue: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: 0.5,
  },
  accuracyBadge: {
    backgroundColor: Colors.successLight,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginTop: 2,
  },
  accuracyText: { fontSize: 12, color: Colors.success, fontWeight: '500' },
  refreshBtn: {
    marginTop: 8,
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  refreshBtnText: { color: Colors.primary, fontWeight: '600', fontSize: 15 },
  mapNote: {
    marginTop: 12,
    fontSize: 12,
    color: Colors.textTertiary,
    textAlign: 'center',
    lineHeight: 18,
  },
});
