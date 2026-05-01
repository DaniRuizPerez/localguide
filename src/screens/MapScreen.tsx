import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, ScrollView } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useLocation } from '../hooks/useLocation';
import { useAppMode } from '../hooks/useAppMode';
import { Colors } from '../theme/colors';
import { Type, Radii, Shadows, Sizing, Spacing } from '../theme/tokens';
import { softTactileMapStyle } from '../theme/mapStyle';
import { poiService, type Poi } from '../services/PoiService';
import { SoftButton } from '../components/SoftButton';
import { CompassArrow } from '../components/CompassArrow';
import { TimelineModal } from '../components/TimelineModal';
import { OfflineNotice } from '../components/OfflineNotice';
import { useEdgeSwipeBack } from '../components/EdgeSwipeBack';
import { breadcrumbTrail } from '../services/BreadcrumbTrail';
import { useBreadcrumbTrail } from '../hooks/useBreadcrumbTrail';
import { t } from '../i18n';

type Props = NativeStackScreenProps<RootStackParamList, 'Map'>;

const DEFAULT_DELTA = 0.01;

export default function MapScreen({ navigation }: Props) {
  const { gps, status, errorMessage, refresh } = useLocation();
  // Stack nav: Map is always pushed on top of Chat, so goBack() pops.
  // If for some reason the stack is empty (e.g. deep-linked straight to Map),
  // fall back to an explicit navigate('Chat').
  const goBackToChat = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Chat');
  };
  const swipeBackHandlers = useEdgeSwipeBack(goBackToChat);
  const mapRef = useRef<MapView>(null);
  const didInitialCenter = useRef(false);
  const [pois, setPois] = useState<Poi[]>([]);
  const [compassTarget, setCompassTarget] = useState<Poi | null>(null);
  const [timelinePoi, setTimelinePoi] = useState<Poi | null>(null);
  const { effective } = useAppMode();
  const trail = useBreadcrumbTrail();

  // Record every GPS fix into the breadcrumb buffer. The service itself
  // handles distance de-duplication so fast callbacks don't thrash storage.
  useEffect(() => {
    if (!gps) return;
    breadcrumbTrail.record(gps.latitude, gps.longitude);
  }, [gps]);

  useEffect(() => {
    if (!gps || didInitialCenter.current) return;
    didInitialCenter.current = true;
    mapRef.current?.animateToRegion(buildRegion(gps), 600);
  }, [gps]);

  // Fetch nearby POIs for the map pins + bottom sheet. Coarse grid-cell cache
  // so tiny GPS jitter doesn't thrash the network. Offline mode uses the
  // bundled GeoNames data via PoiService so the map still shows real pins.
  useEffect(() => {
    if (!gps) return;
    let cancelled = false;
    const offline = effective === 'offline';
    poiService.fetchNearby(gps.latitude, gps.longitude, 2000, 6, { offline }).then((list) => {
      if (cancelled) return;
      setPois(list);
    });
    return () => {
      cancelled = true;
    };
  }, [gps && gps.latitude.toFixed(3), gps && gps.longitude.toFixed(3), effective]);

  const recenter = () => {
    if (!gps) return;
    mapRef.current?.animateToRegion(buildRegion(gps), 400);
  };

  if (status === 'requesting' && !gps) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={[Type.body, { color: Colors.textSecondary, marginTop: 12 }]}>
          {t('map.gettingLocation')}
        </Text>
      </View>
    );
  }

  if ((status === 'denied' || status === 'error') && !gps) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorIcon}>📍</Text>
        <Text style={[Type.body, { color: Colors.error, textAlign: 'center', marginTop: 8 }]}>
          {errorMessage ?? t('map.locationUnavailable')}
        </Text>
        <View style={{ marginTop: 16 }}>
          <SoftButton label={t('map.retry')} onPress={refresh} size="md" />
        </View>
      </View>
    );
  }

  const initialRegion = gps ? buildRegion(gps) : undefined;

  // Google Maps SDK throws IllegalStateException on a background thread when
  // android:value="com.google.android.geo.API_KEY" is missing from the
  // merged manifest, and that crash can't be caught by a React error
  // boundary. Gate MapView so we render a friendly fallback instead of
  // taking the whole app down.
  const mapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

  if (!mapsApiKey) {
    return (
      <View style={[styles.container, styles.centered]} {...swipeBackHandlers}>
        <Text style={[Type.h1, { color: Colors.text, textAlign: 'center', paddingHorizontal: Spacing.lg }]}>
          {t('map.unavailableTitle')}
        </Text>
        <Text style={[Type.body, { color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.sm, paddingHorizontal: Spacing.lg }]}>
          {t('map.unavailableBody')}
        </Text>
        <View style={{ marginTop: Spacing.lg }}>
          <SoftButton label={t('nav.back')} onPress={goBackToChat} size="md" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} {...swipeBackHandlers}>
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
        {trail.length >= 2 && (
          <Polyline
            coordinates={trail.map((p) => ({ latitude: p.latitude, longitude: p.longitude }))}
            strokeColor={Colors.primary}
            strokeWidth={4}
            geodesic
          />
        )}
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
        <OfflineNotice />
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
        style={styles.backBtn}
        onPress={goBackToChat}
        accessibilityLabel={t('nav.back')}
        accessibilityRole="button"
        testID="map-back-btn"
      >
        <Text style={styles.backGlyph}>‹</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.fab}
        onPress={recenter}
        disabled={!gps}
        accessibilityLabel="Recenter"
      >
        <Text style={styles.fabGlyph}>◎</Text>
      </TouchableOpacity>

      {trail.length > 0 && (
        <TouchableOpacity
          style={[styles.fab, styles.trailFab]}
          onPress={() => breadcrumbTrail.clear()}
          accessibilityLabel={t('map.clearTrail')}
        >
          <Text style={styles.fabGlyph}>⌀</Text>
        </TouchableOpacity>
      )}

      <View style={styles.sheet} pointerEvents="box-none">
        <View style={styles.sheetHandle} />
        <Text style={[Type.title, { color: Colors.text }]}>{t('map.aroundYou')}</Text>
        <Text style={[Type.hint, { color: Colors.textTertiary, marginTop: 2 }]}>
          {pois.length > 0
            ? t('map.stopsPickedOut', { count: pois.length })
            : t('map.scanning')}
        </Text>

        {compassTarget && gps && compassTarget.source !== 'llm' && (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => setCompassTarget(null)}
            accessibilityHint={t('compass.tapToClear')}
            style={{ marginTop: 10 }}
          >
            <CompassArrow
              targetLat={compassTarget.latitude}
              targetLon={compassTarget.longitude}
              userLat={gps.latitude}
              userLon={gps.longitude}
              label={compassTarget.title}
            />
          </TouchableOpacity>
        )}

        <ScrollView
          // Cap the inline POI list to ~22vh so on small phones it doesn't
          // crowd the map and on big phones we use the extra real estate.
          style={{ marginTop: 10, maxHeight: Sizing.vh(22) }}
          contentContainerStyle={{ gap: 6 }}
          showsVerticalScrollIndicator={false}
        >
          {pois.map((p) => {
            const isTarget = compassTarget?.pageId === p.pageId;
            const canGuide = p.source !== 'llm';
            return (
              <TouchableOpacity
                key={`row-${p.source}-${p.pageId}`}
                style={[styles.poiRow, isTarget && styles.poiRowActive]}
                onPress={() => {
                  if (!canGuide) return;
                  setCompassTarget(isTarget ? null : p);
                }}
                accessibilityRole="button"
                accessibilityLabel={t('compass.guideMeTo', { label: p.title })}
                activeOpacity={canGuide ? 0.7 : 1}
              >
                <View style={styles.poiIcon}>
                  <Text style={{ fontSize: 14 }}>{p.source === 'llm' ? '🧠' : '📍'}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={[Type.poi, { color: Colors.text }]} numberOfLines={1}>
                    {p.title}
                  </Text>
                  <Text style={[Type.hint, { color: Colors.textTertiary }]} numberOfLines={1}>
                    {p.source === 'llm' ? t('map.aiSuggested') : t('map.wikipedia')}
                  </Text>
                </View>
                <View style={styles.poiBadge}>
                  <Text style={[Type.chip, { color: Colors.primary }]}>
                    {p.distanceMeters < 1000
                      ? `${Math.round(p.distanceMeters)} m`
                      : `${(p.distanceMeters / 1000).toFixed(1)} km`}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.timelineIcon}
                  onPress={(e) => {
                    e.stopPropagation?.();
                    setTimelinePoi(p);
                  }}
                  accessibilityLabel={t('timeline.openButton')}
                  testID={`timeline-${p.pageId}`}
                >
                  <Text style={{ fontSize: 14 }}>📜</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <TimelineModal
        visible={timelinePoi != null}
        onClose={() => setTimelinePoi(null)}
        poiTitle={timelinePoi?.title ?? null}
        location={gps}
      />
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
  backBtn: {
    position: 'absolute',
    top: 12,
    left: 12,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.softOutset,
  },
  backGlyph: {
    fontSize: 24,
    lineHeight: 26,
    color: Colors.textSecondary,
    marginTop: -2,
  },
  fabGlyph: {
    fontSize: 20,
    color: Colors.primary,
  },
  trailFab: {
    bottom: 292,
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
  poiRowActive: {
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: 'rgba(232,132,92,0.08)',
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
  timelineIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
});
