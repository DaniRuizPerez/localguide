import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { RootTabParamList } from '../navigation/AppNavigator';
import { useLocation } from '../hooks/useLocation';
import { Colors } from '../theme/colors';

type Props = BottomTabScreenProps<RootTabParamList, 'Map'>;

const DEFAULT_DELTA = 0.01;

export default function MapScreen(_props: Props) {
  const { gps, status, errorMessage, refresh } = useLocation();
  const mapRef = useRef<MapView>(null);
  const didInitialCenter = useRef(false);

  useEffect(() => {
    if (!gps || didInitialCenter.current) return;
    didInitialCenter.current = true;
    mapRef.current?.animateToRegion(buildRegion(gps), 600);
  }, [gps]);

  const recenter = () => {
    if (!gps) return;
    mapRef.current?.animateToRegion(buildRegion(gps), 400);
  };

  if (status === 'requesting' && !gps) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Getting your location…</Text>
      </View>
    );
  }

  if ((status === 'denied' || status === 'error') && !gps) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorIcon}>📍</Text>
        <Text style={styles.errorText}>{errorMessage ?? 'Location unavailable'}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={refresh}>
          <Text style={styles.retryBtnText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const initialRegion = gps ? buildRegion(gps) : undefined;

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFillObject}
        initialRegion={initialRegion}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass
        toolbarEnabled={false}
      >
        {gps && (
          <Marker
            coordinate={{ latitude: gps.latitude, longitude: gps.longitude }}
            title="You are here"
            description={gps.accuracy != null ? `±${Math.round(gps.accuracy)}m` : undefined}
          />
        )}
      </MapView>

      <View style={styles.overlayTop} pointerEvents="box-none">
        {gps && (
          <View style={styles.coordPill}>
            <Text style={styles.coordPillText}>
              {gps.latitude.toFixed(5)}, {gps.longitude.toFixed(5)}
              {gps.accuracy != null ? `  ·  ±${Math.round(gps.accuracy)}m` : ''}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.overlayBottom} pointerEvents="box-none">
        <TouchableOpacity style={styles.fab} onPress={recenter} disabled={!gps}>
          <Text style={styles.fabText}>📍</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.fab, styles.fabSecondary]} onPress={refresh}>
          <Text style={styles.fabText}>↻</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function buildRegion(gps: { latitude: number; longitude: number }): Region {
  return {
    latitude: gps.latitude,
    longitude: gps.longitude,
    latitudeDelta: DEFAULT_DELTA,
    longitudeDelta: DEFAULT_DELTA,
  };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  loadingText: { color: Colors.textSecondary, fontSize: 16 },
  errorIcon: { fontSize: 48 },
  errorText: { color: Colors.error, fontSize: 15, textAlign: 'center' },
  retryBtn: {
    marginTop: 8,
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 12,
    elevation: 3,
  },
  retryBtnText: { color: Colors.surface, fontWeight: '600', fontSize: 15 },
  overlayTop: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    alignItems: 'center',
  },
  coordPill: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  coordPillText: { fontSize: 12, color: Colors.textPrimary, fontWeight: '600' },
  overlayBottom: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    gap: 10,
  },
  fab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  fabSecondary: {
    backgroundColor: Colors.surfaceAlt,
  },
  fabText: { fontSize: 20 },
});