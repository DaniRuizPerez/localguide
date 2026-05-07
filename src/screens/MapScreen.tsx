import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, ScrollView, Animated, PanResponder, Dimensions, KeyboardAvoidingView, Keyboard } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type Region, type PoiClickEvent } from 'react-native-maps';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useLocation } from '../hooks/useLocation';
import { useAppMode } from '../hooks/useAppMode';
import { useNearbyPois } from '../hooks/useNearbyPois';
import { useRankedPois } from '../hooks/useRankedPois';
import { useRadiusPref } from '../hooks/useRadiusPref';
import { useChatMessages } from '../hooks/useChatMessages';
import { useGuideStream } from '../hooks/useGuideStream';
import { Colors } from '../theme/colors';
import { Type, Radii, Shadows, Sizing, Spacing } from '../theme/tokens';
import { softTactileMapStyle } from '../theme/mapStyle';
import { type Poi, distanceMeters } from '../services/PoiService';
import { wikipediaService } from '../services/WikipediaService';
import { guidePrefs } from '../services/GuidePrefs';
import { chatStore } from '../services/ChatStore';
import { SoftButton } from '../components/SoftButton';
import { CompassArrow } from '../components/CompassArrow';
import { MessageList } from '../components/MessageList';
import { ChatInputBar } from '../components/ChatInputBar';
import { OfflineNotice } from '../components/OfflineNotice';
import { useEdgeSwipeBack } from '../components/EdgeSwipeBack';
import { breadcrumbTrail } from '../services/BreadcrumbTrail';
import { useBreadcrumbTrail } from '../hooks/useBreadcrumbTrail';
import { t } from '../i18n';

type Props = NativeStackScreenProps<RootStackParamList, 'Map'>;

const DEFAULT_DELTA = 0.01;

// Pullup sheet snap-point math. Sheet is positioned `bottom: 0` with a fixed
// height; we translate it down to "collapse" and to 0 to "expand fully". The
// peek values were tuned on a Pixel 3 (1080×2160). Computed once at module
// load — orientation changes are rare on this app's intended use.
const SCREEN_H = Dimensions.get('window').height;
const SHEET_HEIGHT = Math.round(SCREEN_H * 0.85);
const SNAP_FULL = 0;                                 // entire sheet visible
const SNAP_HALF = Math.round(SHEET_HEIGHT * 0.55);   // ~45% visible — default landing
const SNAP_COLLAPSED = SHEET_HEIGHT - 150;           // 150 px peek (handle + header tease)
const SNAP_POINTS = [SNAP_FULL, SNAP_HALF, SNAP_COLLAPSED] as const;
const FLING_VY_THRESHOLD = 0.5;                      // velocity threshold for fling-to-snap

function nearestSnap(y: number, vy: number): number {
  if (vy < -FLING_VY_THRESHOLD) return SNAP_FULL;
  if (vy > FLING_VY_THRESHOLD) return SNAP_COLLAPSED;
  return SNAP_POINTS.reduce((best, c) => (Math.abs(c - y) < Math.abs(best - y) ? c : best));
}

export { nearestSnap, SNAP_FULL, SNAP_HALF, SNAP_COLLAPSED }; // for unit test

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
  const [compassTarget, setCompassTarget] = useState<Poi | null>(null);
  const [tab, setTab] = useState<'places' | 'chat'>('places');
  const [chatInput, setChatInput] = useState('');
  const { effective } = useAppMode();
  const trail = useBreadcrumbTrail();

  // ── Chat hooks for the pullup Chat tab ───────────────────────────────────
  const messages = useChatMessages();
  const speakResponsesRef = useRef(true);
  const topicRef = useRef<readonly ['everything']>(['everything']);
  const listRef = useRef<any>(null);
  const { inferring, stream, stop } = useGuideStream({
    messages,
    speakResponsesRef,
    topicRef,
    onScroll: () => listRef.current?.scrollToEnd({ animated: true }),
  });

  const handleSend = async () => {
    const query = chatInput.trim();
    if (!query || inferring) return;
    setChatInput('');
    if (!gps) return;
    messages.addUserMessage(query);
    await stream({ intent: 'text', query, location: gps });
  };

  const askAboutPoi = (p: Poi) => {
    if (!gps) return;
    if (inferring) stop();
    chatStore.addUserMessage(`Tell me about ${p.title}`);
    stream({ intent: 'text', query: `Tell me about ${p.title}.`, location: gps });
    setTab('chat');
    // Snap sheet to FULL
    currentSnapRef.current = SNAP_FULL;
    setAtFull(true);
    Animated.spring(sheetY, { toValue: SNAP_FULL, useNativeDriver: false, tension: 80, friction: 12 }).start();
  };

  // ── Radius + hiddenGems prefs ─────────────────────────────────────────────
  const { radiusMeters } = useRadiusPref();
  const [hiddenGems, setHiddenGems] = useState<boolean>(guidePrefs.get().hiddenGems);
  useEffect(() => guidePrefs.subscribe((p) => setHiddenGems(p.hiddenGems)), []);

  const offline = effective === 'offline';

  // ── POI pipeline: fetch → rank → filter LLM ──────────────────────────────
  const { pois: rawPois } = useNearbyPois(gps, radiusMeters, {
    hiddenGems,
    offline,
    skipLlmFill: !offline,
  });
  const { ranked } = useRankedPois(rawPois, gps, { hiddenGems, offline, radiusMeters });
  // LLM POIs have placeholder coords (= user GPS); never show as map markers.
  const visibleMarkers = ranked.filter((p) => p.source !== 'llm');

  // ── Auto-fit camera ───────────────────────────────────────────────────────
  const userPannedRef = useRef(false);
  const programmaticMoveRef = useRef(false);
  const lastFitRadiusRef = useRef<number | null>(null);
  const didInitialFitRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);

  // Generation counter for Google POI taps. Each tap increments it; async
  // Wikipedia enrichment checks against the latest value before applying its
  // result, so a fast second tap doesn't get clobbered by the first's late
  // response.
  const tapGenRef = useRef(0);

  // ── Pullup bottom sheet (gesture-driven, native-driver spring) ────────────
  // Sheet starts at SNAP_HALF. PanResponder is attached to the drag handle +
  // header only, so the inner ScrollView's scrolls are not intercepted.
  const sheetY = useRef(new Animated.Value(SNAP_HALF)).current;
  const currentSnapRef = useRef<number>(SNAP_HALF);
  const [atFull, setAtFull] = useState(false);
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
        onPanResponderGrant: () => {
          // No setOffset/flattenOffset — those caused inconsistent state
          // across consecutive gestures (the Animated.Value's internal
          // offset accounting got out of sync with currentSnapRef). We
          // just write the absolute position directly each frame.
        },
        onPanResponderMove: (_, g) => {
          const target = currentSnapRef.current + g.dy;
          const clamped = Math.min(Math.max(target, SNAP_FULL), SNAP_COLLAPSED);
          sheetY.setValue(clamped);
        },
        onPanResponderRelease: (_, g) => {
          const releasedY = currentSnapRef.current + g.dy;
          const target = nearestSnap(releasedY, g.vy);
          currentSnapRef.current = target;
          setAtFull(target === SNAP_FULL);
          // useNativeDriver kept FALSE on purpose: once a native-driven
          // spring runs, the Animated.Value gets "captured" on the native
          // side and subsequent `setValue` calls (which PanResponder.move
          // uses to track the finger) have no visual effect. JS-thread
          // springs still hit 60 fps for the short snap window on Pixel 3.
          Animated.spring(sheetY, {
            toValue: target,
            useNativeDriver: false,
            tension: 80,
            friction: 12,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(sheetY, {
            toValue: currentSnapRef.current,
            useNativeDriver: false,
            tension: 80,
            friction: 12,
          }).start();
        },
      }),
    [sheetY]
  );

  const handleGooglePoi = async (e: PoiClickEvent) => {
    const { name, coordinate } = e.nativeEvent;
    const myGen = ++tapGenRef.current;

    // Overlap dedup: if the Google POI matches one already in our ranked list
    // (case-insensitive trimmed title), reuse that Poi — no stub, no extra
    // network call. Stanford Memorial Church is the canonical example.
    const existing = ranked.find(
      (p) => p.title.trim().toLowerCase() === name.trim().toLowerCase()
    );
    if (existing) {
      setCompassTarget(existing);
      return;
    }

    // Synthesize a stub Poi with a guaranteed-disjoint negative pageId
    // (same pattern as LLM POIs in useNearbyPois.ts).
    const stub: Poi = {
      pageId: -Date.now(),
      title: name,
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      distanceMeters: gps
        ? distanceMeters(gps.latitude, gps.longitude, coordinate.latitude, coordinate.longitude)
        : 0,
      source: 'google',
    };
    setCompassTarget(stub);

    // Enrich with Wikipedia. Try exact title first; on miss, fuzzy-match via
    // opensearch (e.g. "Cantor Arts Center" → "Cantor Center for Visual
    // Arts"). Generation guard drops stale resolutions.
    let summary = await wikipediaService.summary(name).catch(() => null);
    if (myGen !== tapGenRef.current) return;
    if (!summary) {
      summary = await wikipediaService.searchByName(name).catch(() => null);
      if (myGen !== tapGenRef.current) return;
    }
    if (summary) {
      setCompassTarget((prev) =>
        prev?.pageId === stub.pageId
          ? { ...stub, description: summary!.description ?? summary!.extract }
          : prev
      );
    }
  };

  // Fit camera to markers + user position whenever markers arrive or radius changes.
  // Gated on mapReady because Android react-native-maps drops fitToCoordinates
  // calls that arrive before onMapReady; without the gate the camera silently
  // stays at initialRegion (~1 km around the user) even with 15 markers loaded.
  useEffect(() => {
    if (!gps) return;
    if (!mapReady) return;

    const isFirstArrival = !didInitialFitRef.current && visibleMarkers.length > 0;
    const radiusChanged = lastFitRadiusRef.current !== null && lastFitRadiusRef.current !== radiusMeters;

    if (visibleMarkers.length === 0) {
      // Nothing to fit yet — if this is truly the first render, animate to GPS point.
      if (!didInitialFitRef.current) {
        programmaticMoveRef.current = true;
        mapRef.current?.animateToRegion(buildRegion(gps), 600);
      }
      return;
    }

    if (!isFirstArrival && !radiusChanged) return;
    if (radiusChanged && userPannedRef.current) {
      // User has manually panned; respect their viewport even on radius change.
      lastFitRadiusRef.current = radiusMeters;
      return;
    }

    const coords = [
      { latitude: gps.latitude, longitude: gps.longitude },
      ...visibleMarkers.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
    ];

    programmaticMoveRef.current = true;
    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 80, bottom: 280, left: 40, right: 40 },
      animated: true,
    });

    didInitialFitRef.current = true;
    lastFitRadiusRef.current = radiusMeters;
  }, [visibleMarkers, radiusMeters, gps, mapReady]);

  // Record every GPS fix into the breadcrumb buffer. The service itself
  // handles distance de-duplication so fast callbacks don't thrash storage.
  useEffect(() => {
    if (!gps) return;
    breadcrumbTrail.record(gps.latitude, gps.longitude);
  }, [gps]);

  // Auto-snap sheet to FULL when the keyboard shows (chat input focused).
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      if (currentSnapRef.current !== SNAP_FULL) {
        currentSnapRef.current = SNAP_FULL;
        setAtFull(true);
        Animated.spring(sheetY, {
          toValue: SNAP_FULL,
          useNativeDriver: false,
          tension: 80,
          friction: 12,
        }).start();
      }
    });
    return () => sub.remove();
  }, [sheetY]);

  const recenter = () => {
    if (!gps) return;
    userPannedRef.current = false;
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
        onMapReady={() => setMapReady(true)}
        onPoiClick={handleGooglePoi}
        onRegionChangeComplete={(_region, details) => {
          if (programmaticMoveRef.current) {
            programmaticMoveRef.current = false;
            return;
          }
          // isGesture is present in react-native-maps ≥1.x; fall back to
          // treating all non-programmatic region changes as gestures.
          const isGesture = (details as { isGesture?: boolean } | undefined)?.isGesture ?? true;
          if (isGesture) userPannedRef.current = true;
        }}
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
        {visibleMarkers.map((p, idx) => {
          const isPrimary = idx < 3;
          const isSelected = compassTarget?.pageId === p.pageId;
          return (
            <Marker
              key={`${p.source}-${p.pageId}`}
              coordinate={{ latitude: p.latitude, longitude: p.longitude }}
              anchor={{ x: 0.5, y: 0.5 }}
              onPress={() => setCompassTarget(p)}
              tracksViewChanges={isSelected}
            >
              <View style={styles.poiMarkerWrap}>
                <View style={isPrimary ? styles.poiDotPrimary : styles.poiDotSecondary} />
                <View style={styles.poiLabelPill}>
                  <Text style={styles.poiLabelText} numberOfLines={1}>{p.title}</Text>
                </View>
                {isSelected && (
                  <View style={styles.poiCallout}>
                    <Text style={styles.poiCalloutText} numberOfLines={1}>
                      {p.title}
                    </Text>
                  </View>
                )}
              </View>
            </Marker>
          );
        })}
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

      <Animated.View
        style={[styles.sheet, { transform: [{ translateY: sheetY }] }]}
        pointerEvents="box-none"
      >
        <View {...panResponder.panHandlers} style={styles.sheetDragArea}>
          <View style={styles.sheetHandle} />
          <Text style={[Type.title, { color: Colors.text }]}>{t('map.aroundYou')}</Text>
          <Text style={[Type.hint, { color: Colors.textTertiary, marginTop: 2 }]}>
            {ranked.length > 0
              ? t('map.stopsPickedOut', { count: ranked.length })
              : t('map.scanning')}
          </Text>
        </View>

        {/* Tab switcher */}
        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'places' && styles.tabBtnActive]}
            onPress={() => setTab('places')}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === 'places' }}
          >
            <Text style={[styles.tabBtnText, tab === 'places' && styles.tabBtnTextActive]}>
              Places
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'chat' && styles.tabBtnActive]}
            onPress={() => setTab('chat')}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === 'chat' }}
          >
            <Text style={[styles.tabBtnText, tab === 'chat' && styles.tabBtnTextActive]}>
              Chat
            </Text>
          </TouchableOpacity>
        </View>

        {tab === 'places' && (
          <>
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
              // ScrollView only scrolls at the Full snap; at Half/Collapsed the
              // user expects vertical drags to move the sheet, not the list.
              // Without this guard a drag in the list area would scroll instead
              // of pulling the sheet up. removeClippedSubviews trims off-screen
              // rows on Android for a small render-cost win at Full.
              scrollEnabled={atFull}
              removeClippedSubviews
              style={{ marginTop: 10, flex: 1 }}
              contentContainerStyle={{ gap: 6, paddingBottom: 12 }}
              showsVerticalScrollIndicator={atFull}
            >
              {ranked.map((p) => {
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
                        askAboutPoi(p);
                      }}
                      accessibilityLabel="Ask about this place"
                      testID={`ask-${p.pageId}`}
                    >
                      <Text style={{ fontSize: 14 }}>💬</Text>
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </>
        )}

        {tab === 'chat' && (
          <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
            <MessageList
              ref={listRef}
              messages={messages.messages}
              autoGuideEnabled={false}
              onSendChip={() => {}}
            />
            {currentSnapRef.current !== SNAP_COLLAPSED && (
              <ChatInputBar
                input={chatInput}
                onChangeInput={setChatInput}
                onSend={handleSend}
                onStop={stop}
                inferring={inferring}
                onCameraPress={() => {}}
                onMicToggle={() => {}}
                isListening={false}
              />
            )}
          </KeyboardAvoidingView>
        )}
      </Animated.View>
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
  // ── New dot marker styles ────────────────────────────────────────────────
  // alignItems: 'center' centres dot + label. minWidth ensures Android
  // react-native-maps measures a non-zero bitmap on first render.
  poiMarkerWrap: {
    alignItems: 'center',
    minWidth: 18,
  },
  poiDotPrimary: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.primary,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    ...Shadows.pinDrop,
  },
  poiDotSecondary: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.textSecondary,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    ...Shadows.pinDrop,
  },
  poiLabelPill: {
    marginTop: 2,
    backgroundColor: Colors.surface,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    paddingHorizontal: 4,
    paddingVertical: 1,
    maxWidth: 100,
  },
  poiLabelText: {
    fontSize: 9,
    color: Colors.text,
  },
  poiCallout: {
    position: 'absolute',
    bottom: 22,
    backgroundColor: Colors.surface,
    borderRadius: Radii.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 80,
    maxWidth: 140,
    zIndex: 10,
    ...Shadows.pinDrop,
  },
  poiCalloutText: {
    ...Type.chip,
    color: Colors.text,
  },
  // ── End new dot marker styles ───────────────────────────────────────────
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
    height: SHEET_HEIGHT,
    backgroundColor: Colors.surface,
    borderRadius: Radii.xl,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 14,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.softFloating,
  },
  // Drag area covers the handle + header text. PanResponder is attached only
  // here so the inner ScrollView can capture its own touches at Full snap.
  // The padding gives a generous tap target — easier than fishing for the
  // 4×40 handle bar alone.
  sheetDragArea: {
    paddingTop: 4,
    paddingBottom: 8,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.borderLight,
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
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: 'rgba(232,132,92,0.08)',
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
  tabRow: {
    flexDirection: 'row',
    marginTop: 8,
    borderRadius: Radii.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  tabBtn: {
    flex: 1,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  tabBtnActive: {
    backgroundColor: Colors.primary,
  },
  tabBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  tabBtnTextActive: {
    color: '#FFFFFF',
  },
});
