import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, ScrollView } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { RootTabParamList } from '../navigation/AppNavigator';
import { useLocation } from '../hooks/useLocation';
import { Colors } from '../theme/colors';
import { Type, Radii, Shadows, Spacing } from '../theme/tokens';
import { softTactileMapStyle } from '../theme/mapStyle';
import { poiService, type Poi } from '../services/PoiService';
import { SoftButton } from '../components/SoftButton';

type Props = BottomTabScreenProps<RootTabParamList, 'Map'>;

const DEFAULT_DELTA = 0.01;

export default function MapScreen(_props: Props) {
  const { gps, status, errorMessage, refresh } = useLocation();
  const mapRef = useRef<MapView>(null);
  const didInitialCenter = useRef(false);
  const [pois, setPois] = useState<Poi[]>([]);

  useEffect(() => {
    if (!gps || didInitialCenter.current) return;
    didInitialCenter.current = true;
    mapRef.current?.animateToRegion(buildRegion(gps), 600);
  }, [gps]);

  // Fetch nearby POIs for the map pins + bottom sheet. Coarse grid-cell cache
  // so tiny GPS jitter doesn't thrash the network.
  useEffect(() => {
    if (!gps) return;
    let cancelled = false;
    poiService.fetchNearby(gps.latitude, gps.longitude, 2000).then((list) => {
      if (cancelled) return;
      setPois(list.slice(0, 6));
    });
    return () => {
      cancelled = true;
    };
  }, [gps && gps.latitude.toFixed(3), gps && gps.longitude.toFixed(3)]);

  const recenter = () => {
    if (!gps) return;
    mapRef.current?.animateToRegion(buildRegion(gps), 400);
  };

  if (status === 'requesting' && !gps) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={[Type.body, { color: Colors.textSecondary, marginTop: 12 }]}>
          Getting your location…
        </Text>
      </View>
    );
  }

  if ((status === 'denied' || status === 'error') && !gps) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorIcon}>📍</Text>
        <Text style={[Type.body, { color: Colors.error, textAlign: 'center', marginTop: 8 }]}>
          {errorMessage ?? 'Location unavailable'}
        </Text>
        <View style={{ marginTop: 16 }}>
          <SoftButton label="Retry" onPress={refresh} size="md" />
        </View>
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
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
        customMapStyle={softTactileMapStyle}
      >
        {gps && (
          <Marker
            coordinate={{ latitude: gps.latitude, longitude: gps.longitude }}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.userDotHalo}>
              <View style={styles.userDot} />
            </View>
          </Marker>
        )}
        {pois.map((p) => (
          <Marker
            key={`${p.source}-${p.pageId}`}
            coordinate={{ latitude: p.latitude, longitude: p.longitude }}
            anchor={{ x: 0.5, y: 1 }}
          >
            <View style={styles.poiPin}>
              <Text style={styles.poiPinLabel} numberOfLines={1}>
                {p.title}
              </Text>
              <View style={styles.poiPinDot} />
            </View>
          </Marker>
        ))}
      </MapView>

      <View style={styles.overlayTop} pointerEvents="box-none">
        {gps && (
          <View style={styles.coordPill}>
            <View style={[styles.statusDot, { backgroundColor: Colors.success }]} />
            <Text style={[Type.chip, { color: Colors.text }]}>
              {gps.latitude.toFixed(4)}° · {gps.longitude.toFixed(4)}°
              {gps.accuracy != null ? `  ·  ±${Math.round(gps.accuracy)}m` : ''}
            </Text>
          </View>
        )}
      </View>

      <TouchableOpacity
        style={styles.fab}
        onPress={recenter}
        disabled={!gps}
        accessibilityLabel="Recenter"
      >
        <Text style={styles.fabGlyph}>◎</Text>
      </TouchableOpacity>

      <View style={styles.sheet} pointerEvents="box-none">
        <View style={styles.sheetHandle} />
        <Text style={[Type.title, { color: Colors.text }]}>Around you now</Text>
        <Text style={[Type.hint, { color: Colors.textTertiary, marginTop: 2 }]}>
          {pois.length > 0 ? `${pois.length} stops your guide picked out` : 'Scanning for nearby stops…'}
        </Text>
        <ScrollView
          style={{ marginTop: 10, maxHeight: 160 }}
          contentContainerStyle={{ gap: 6 }}
          showsVerticalScrollIndicator={false}
        >
          {pois.map((p) => (
            <View key={`row-${p.source}-${p.pageId}`} style={styles.poiRow}>
              <View style={styles.poiIcon}>
                <Text style={{ fontSize: 14 }}>{p.source === 'llm' ? '🧠' : '📍'}</Text>
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={[Type.poi, { color: Colors.text }]} numberOfLines={1}>
                  {p.title}
                </Text>
                <Text style={[Type.hint, { color: Colors.textTertiary }]} numberOfLines={1}>
                  {p.source === 'llm' ? 'AI suggested' : 'Wikipedia'}
                </Text>
              </View>
              <View style={styles.poiBadge}>
                <Text style={[Type.chip, { color: Colors.primary }]}>
                  {p.distanceMeters < 1000
                    ? `${Math.round(p.distanceMeters)} m`
                    : `${(p.distanceMeters / 1000).toFixed(1)} km`}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
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
  container: { flex: 1, backgroundColor: Colors.mapBackground },
  centered: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorIcon: { fontSize: 48 },
  overlayTop: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    alignItems: 'center',
  },
  coordPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surface,
    borderRadius: Radii.lg,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.softOutset,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  userDotHalo: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(232,132,92,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.primary,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    ...Shadows.pinDrop,
  },
  poiPin: {
    alignItems: 'center',
    maxWidth: 140,
  },
  poiPinLabel: {
    ...Type.chip,
    color: Colors.text,
    backgroundColor: Colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radii.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginBottom: 2,
    ...Shadows.pinDrop,
  },
  poiPinDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.primary,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 240,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.softOutset,
  },
  fabGlyph: {
    fontSize: 20,
    color: Colors.primary,
  },
  sheet: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    backgroundColor: Colors.surface,
    borderRadius: Radii.xl,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 14,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.softFloating,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 10,
  },
  poiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: Radii.md,
  },
  poiIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  poiBadge: {
    backgroundColor: 'rgba(232,132,92,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radii.sm,
    marginLeft: Spacing.sm,
  },
});
