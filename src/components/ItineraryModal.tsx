import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../theme/colors';
import { Radii, Shadows, Sizing, Spacing, Type } from '../theme/tokens';
import { t } from '../i18n';
import { PillowChip } from './PillowChip';
import {
  localGuideService,
  type ItinerarySource,
  type ItineraryStop,
  type ItineraryTask,
} from '../services/LocalGuideService';
import type { GPSContext } from '../services/InferenceService';
import { distanceMeters, type Poi } from '../services/PoiService';
import { visitedStore } from '../services/VisitedStore';
import { appMode } from '../services/AppMode';
import { routeService, type WalkingMatrix } from '../services/RouteService';
import { useUnitPref } from '../hooks/useUnitPref';
import { formatDistance } from '../utils/formatDistance';

interface Props {
  visible: boolean;
  onClose: () => void;
  location: GPSContext | string | null;
  nearbyPois: Poi[];
  // Fired when the user taps a stop card — typically dismisses the sheet
  // and switches the chat to that place. Optional so the modal renders in
  // contexts (tests, previews) where chat isn't wired up.
  onChatAboutStop?: (title: string) => void;
}

const DURATIONS: Array<{ hours: number; labelKey: 'oneHour' | 'halfDay' | 'fullDay' }> = [
  { hours: 1, labelKey: 'oneHour' },
  { hours: 4, labelKey: 'halfDay' },
  { hours: 8, labelKey: 'fullDay' },
];

const DEFAULT_HOURS = 4;

// ─── Leg type ─────────────────────────────────────────────────────────────────

export interface RouteLeg {
  minutes: number;
  meters: number;
  source: 'osrm' | 'haversine';
}

export interface RouteResult<T> {
  order: T[];
  legs: RouteLeg[];
  totalMin: number;
  totalM: number;
}

// ─── optimizeWalkingOrder ─────────────────────────────────────────────────────

// NN + 2-opt route optimisation. Now async so it can consult the OSRM matrix.
// The anchor (GPS or stops[0]) is node 0 and stays fixed; the returned `order`
// contains only the stops (not the anchor itself).
//
// When gps is null, anchor falls back to stops[0]'s position so leg 0 still
// exists and the open-tour logic is consistent whether or not GPS is available.
async function optimizeWalkingOrder<T extends { latitude: number; longitude: number; title: string }>(
  stops: T[],
  anchor: { lat: number; lon: number } | null,
  opts: { online: boolean }
): Promise<RouteResult<T>> {
  if (stops.length === 0) {
    return { order: [], legs: [], totalMin: 0, totalM: 0 };
  }

  // The effective anchor: GPS if available, else stop[0]'s position.
  const effectiveAnchor: { lat: number; lon: number } = anchor ?? {
    lat: stops[0].latitude,
    lon: stops[0].longitude,
  };

  // Coord list: anchor first, then all stops.
  const coordList: Array<{ lat: number; lon: number }> = [
    effectiveAnchor,
    ...stops.map((s) => ({ lat: s.latitude, lon: s.longitude })),
  ];

  // Try to get an OSRM matrix when online.
  let matrix: WalkingMatrix | null = null;
  if (opts.online && stops.length >= 2) {
    matrix = await routeService.walkingTimeMatrix(coordList);
  }

  // Distance function: either matrix lookup or haversine.
  // Indices here are into coordList (0 = anchor).
  const distFn = (i: number, j: number): number => {
    if (matrix) {
      return matrix.meters[i][j];
    }
    return distanceMeters(
      coordList[i].lat,
      coordList[i].lon,
      coordList[j].lat,
      coordList[j].lon
    );
  };

  if (stops.length === 1) {
    // Only one stop — trivial route from anchor to that stop.
    const legMeters = distFn(0, 1);
    const legMinutes = matrix
      ? matrix.minutes[0][1]
      : Math.max(1, Math.round(legMeters / (5000 / 60)));
    const legSource: 'osrm' | 'haversine' = matrix ? 'osrm' : 'haversine';
    return {
      order: [stops[0]],
      legs: [{ minutes: legMinutes, meters: legMeters, source: legSource }],
      totalMin: legMinutes,
      totalM: legMeters,
    };
  }

  // Stops are at coordList indices 1..n. Node 0 (anchor) is fixed.
  // We work in 1-based indices into coordList for the optimiser, then map back.
  const n = stops.length;
  const stopIndices = Array.from({ length: n }, (_, k) => k + 1); // [1, 2, ..., n]

  // Step 1: greedy nearest-neighbor from anchor (index 0), node 0 fixed.
  const remaining = [...stopIndices];
  let orderedIndices: number[] = [];
  let curIdx = 0; // start from anchor
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = distFn(curIdx, remaining[0]);
    for (let i = 1; i < remaining.length; i++) {
      const d = distFn(curIdx, remaining[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const chosen = remaining.splice(bestIdx, 1)[0];
    orderedIndices.push(chosen);
    curIdx = chosen;
  }

  // Step 2: 2-opt on orderedIndices, with anchor (0) fixed as the start.
  // We only swap within orderedIndices (the internal stop permutation).
  // `edgeAt(a, b)` where a=-1 means the anchor.
  const nodeAt = (pos: number): number => (pos === -1 ? 0 : orderedIndices[pos]);
  const edgeDist = (posA: number, posB: number): number =>
    distFn(nodeAt(posA), nodeAt(posB));

  let improved = true;
  let safety = 30;
  while (improved && safety-- > 0) {
    improved = false;
    for (let i = 0; i < orderedIndices.length - 1; i++) {
      for (let j = i + 1; j < orderedIndices.length; j++) {
        // Cost of current edges: (i-1 → i) + (j → j+1)
        const before =
          edgeDist(i - 1, i) +
          (j + 1 < orderedIndices.length ? edgeDist(j, j + 1) : 0);
        // Cost after reversing [i..j]: (i-1 → j) + (i → j+1)
        const after =
          edgeDist(i - 1, j) +
          (j + 1 < orderedIndices.length ? edgeDist(i, j + 1) : 0);
        if (after + 1 < before) {
          orderedIndices = [
            ...orderedIndices.slice(0, i),
            ...orderedIndices.slice(i, j + 1).reverse(),
            ...orderedIndices.slice(j + 1),
          ];
          improved = true;
        }
      }
    }
  }

  // Build legs: leg[0] = anchor → first stop; leg[k] = stop[k-1] → stop[k].
  const legs: RouteLeg[] = [];
  let totalMin = 0;
  let totalM = 0;
  let prevIdx = 0; // anchor
  for (const stopIdx of orderedIndices) {
    const legMeters = matrix ? matrix.meters[prevIdx][stopIdx] : distFn(prevIdx, stopIdx);
    const legMinutes = matrix
      ? matrix.minutes[prevIdx][stopIdx]
      : Math.max(1, Math.round(distFn(prevIdx, stopIdx) / (5000 / 60)));
    const legSource: 'osrm' | 'haversine' = matrix ? 'osrm' : 'haversine';
    legs.push({ minutes: legMinutes, meters: legMeters, source: legSource });
    totalMin += legMinutes;
    totalM += legMeters;
    prevIdx = stopIdx;
  }

  const order = orderedIndices.map((idx) => stops[idx - 1]);
  return { order, legs, totalMin, totalM };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ItineraryModal({
  visible,
  onClose,
  location,
  nearbyPois,
  onChatAboutStop,
}: Props) {
  const insets = useSafeAreaInsets();
  const { units } = useUnitPref();

  // Subscribe to the visited-titles store so the checkmarks rerender when
  // the user toggles one. We hydrate at app boot in App.tsx; here we just
  // mirror the store into local state.
  const [visitedTitles, setVisitedTitles] = useState<Record<string, true>>(
    () => visitedStore.get().titles
  );
  useEffect(() => {
    setVisitedTitles(visitedStore.get().titles);
    return visitedStore.subscribe((s) => setVisitedTitles(s.titles));
  }, []);
  const [duration, setDuration] = useState<number>(DEFAULT_HOURS);
  // Per-duration cache of generated plans. Persists across modal close/
  // reopen and across duration switches so the user can flip 1h → half →
  // full and back without losing what was already planned. Cleared only
  // by an explicit re-plan tap on the CTA.
  const [plans, setPlans] = useState<Map<number, ItineraryStop[]>>(() => new Map());
  const [planSource, setPlanSource] = useState<ItinerarySource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Route state: legs + totals computed by optimizeWalkingOrder (async).
  const [routeLegs, setRouteLegs] = useState<RouteLeg[] | null>(null);
  const [routeTotalMin, setRouteTotalMin] = useState<number>(0);
  const [routeTotalM, setRouteTotalM] = useState<number>(0);
  // While the matrix is in flight (but LLM is already done), show "Optimising route…"
  const [routeOptimising, setRouteOptimising] = useState(false);

  // Tracked in a ref so the visibility/cleanup effects always see the live
  // task, not a stale state snapshot.
  const taskRef = useRef<ItineraryTask | null>(null);

  // Ref holding the in-flight matrix promise kicked off in parallel with the LLM.
  const matrixPromiseRef = useRef<Promise<WalkingMatrix | null> | null>(null);

  const stops = plans.get(duration) ?? [];

  // Pull start lat/lon out once so both the pre-LLM candidate-ordering
  // memo and the post-LLM reorder memo can share it. Null when the user
  // entered a location manually (string) — in that case we skip TSP
  // entirely since we have nothing to measure distance from.
  const startCoord = useMemo(
    () =>
      location && typeof location !== 'string'
        ? { latitude: location.latitude, longitude: location.longitude }
        : null,
    [location]
  );

  // GPS anchor in {lat, lon} shape for routeService calls.
  const gpsAnchor = useMemo(
    () =>
      startCoord
        ? { lat: startCoord.latitude, lon: startCoord.longitude }
        : null,
    [startCoord]
  );

  // Route-optimised candidate list fed to the LLM as visit-order hints.
  // Only POIs with real coordinates are routed; LLM-sourced entries keep
  // their original order at the end because they carry placeholder coords
  // (the user's own position) that would dominate any distance calculation.
  // Capped at 12 entries — the prompt only sends 12 titles anyway.
  const candidateRealPois = useMemo(
    () => nearbyPois.filter((p) => p.source !== 'llm').slice(0, 12),
    [nearbyPois]
  );

  const nearbyTitles = useMemo(() => {
    const llmPois = nearbyPois.filter((p) => p.source === 'llm');
    // Simple distance-sort without async; the TSP post-pass will refine.
    const ordered = startCoord
      ? [...candidateRealPois].sort(
          (a, b) =>
            distanceMeters(startCoord.latitude, startCoord.longitude, a.latitude, a.longitude) -
            distanceMeters(startCoord.latitude, startCoord.longitude, b.latitude, b.longitude)
        )
      : candidateRealPois;
    return [...ordered, ...llmPois].map((p) => p.title).slice(0, 12);
  }, [nearbyPois, startCoord, candidateRealPois]);

  // Match each generated stop to a real POI (by exact title) so we can
  // compute walking-time hints between consecutive stops when possible.
  const enrichedStops = useMemo(() => {
    const byTitle = new Map<string, Poi>();
    for (const poi of nearbyPois) {
      byTitle.set(poi.title.toLowerCase(), poi);
    }
    return stops.map((s) => ({
      stop: s,
      poi: byTitle.get(s.title.toLowerCase()) ?? null,
    }));
  }, [stops, nearbyPois]);

  // Current effective mode (online/offline).
  const [effectiveMode, setEffectiveMode] = useState(() => appMode.get());
  useEffect(() => {
    return appMode.subscribe((m) => setEffectiveMode(m));
  }, []);

  const plan = (hours: number) => {
    if (!location) return;
    taskRef.current?.abort();
    setPlans((prev) => {
      const next = new Map(prev);
      next.delete(hours);
      return next;
    });
    setError(null);
    setLoading(true);
    setRouteLegs(null);
    setRouteTotalMin(0);
    setRouteTotalM(0);
    setRouteOptimising(false);

    const isOnline = effectiveMode === 'online';

    // Kick off the matrix for the candidate pool in parallel with the LLM.
    // We only do this when online and there are enough real POIs to route.
    if (isOnline && candidateRealPois.length >= 2) {
      const coordList = gpsAnchor
        ? [gpsAnchor, ...candidateRealPois.map((p) => ({ lat: p.latitude, lon: p.longitude }))]
        : candidateRealPois.map((p) => ({ lat: p.latitude, lon: p.longitude }));
      // Cap to 12 for OSRM.
      const capped = coordList.slice(0, 12);
      matrixPromiseRef.current = routeService.walkingTimeMatrix(capped);
    } else {
      matrixPromiseRef.current = null;
    }

    const task = localGuideService.planItinerary(location, hours, nearbyTitles, nearbyPois);
    taskRef.current = task;
    task.promise
      .then(async ({ stops: result, source }) => {
        // Drop late results from a superseded request.
        if (taskRef.current !== task) return;
        if (result.length === 0) {
          setError(t('itinerary.empty'));
          return;
        }
        setPlanSource(source);
        setPlans((prev) => {
          const next = new Map(prev);
          next.set(hours, result);
          return next;
        });

        // Now run the async route optimisation on the chosen stops.
        // We pass the stops with their poi coordinates for TSP.
        const byTitle = new Map<string, Poi>();
        for (const poi of nearbyPois) {
          byTitle.set(poi.title.toLowerCase(), poi);
        }
        const matchedStops = result
          .map((s) => {
            const poi = byTitle.get(s.title.toLowerCase());
            return poi
              ? { ...s, latitude: poi.latitude, longitude: poi.longitude }
              : null;
          })
          .filter((s): s is ItineraryStop & { latitude: number; longitude: number } => s !== null);

        if (matchedStops.length < 1) return;

        setRouteOptimising(true);
        try {
          const routeResult = await optimizeWalkingOrder(
            matchedStops,
            gpsAnchor,
            { online: isOnline }
          );
          if (taskRef.current !== task) return;
          // Re-order the plans map entry to match the TSP order.
          const orderedTitles = new Set(routeResult.order.map((s) => s.title.toLowerCase()));
          const reorderedStops = [
            ...routeResult.order,
            // Append any unmatched stops (LLM hallucinations) at the end.
            ...result.filter((s) => !orderedTitles.has(s.title.toLowerCase())),
          ];
          setPlans((prev) => {
            const next = new Map(prev);
            next.set(hours, reorderedStops);
            return next;
          });
          setRouteLegs(routeResult.legs);
          setRouteTotalMin(routeResult.totalMin);
          setRouteTotalM(routeResult.totalM);
        } finally {
          setRouteOptimising(false);
        }
      })
      .catch((err: unknown) => {
        if (taskRef.current !== task) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (taskRef.current !== task) return;
        setLoading(false);
        taskRef.current = null;
      });
  };

  // Auto-start the plan only when the sheet is open AND the current
  // duration has no cached plan AND we're not already generating one.
  // This means: closing and reopening the modal restores whatever was
  // last shown; switching to a different duration with a cached plan
  // shows it instantly; switching to a duration with no plan triggers
  // generation. Errors don't auto-retry — the CTA does that.
  useEffect(() => {
    if (!visible) return;
    if (!location) return;
    if (loading) return;
    if (stops.length > 0) return;
    if (error) return;
    plan(duration);
    // We intentionally exclude `plan`, `nearbyTitles` (recreated each
    // render). `stops` and `loading` are read above to gate the call;
    // `error` too. Listing them in deps would re-fire on every state
    // settle and double-plan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, duration, location]);

  // Abort the in-flight task on close so a stale streamed result doesn't
  // pop in next time. The cached `plans` map and `duration` survive — that
  // is the persistence the user wanted.
  useEffect(() => {
    if (visible) return;
    taskRef.current?.abort();
    taskRef.current = null;
    matrixPromiseRef.current = null;
    setLoading(false);
    setError(null);
    setRouteOptimising(false);
  }, [visible]);

  // Hard cleanup on unmount.
  useEffect(
    () => () => {
      taskRef.current?.abort();
      taskRef.current = null;
    },
    []
  );

  // Invalidate cached plans when the effective online/offline mode flips so
  // a sheet opened in one mode and reopened in the other doesn't show the
  // wrong source-badge / "Generated offline" disclaimer combination.
  useEffect(() => {
    let last = appMode.get();
    return appMode.subscribe((next) => {
      if (next === last) return;
      last = next;
      taskRef.current?.abort();
      taskRef.current = null;
      setPlans(() => new Map());
      setPlanSource(null);
      setError(null);
      setLoading(false);
      setRouteLegs(null);
      setRouteTotalMin(0);
      setRouteTotalM(0);
      setRouteOptimising(false);
    });
  }, []);

  const durationLabel = DURATIONS.find((d) => d.hours === duration)?.labelKey ?? 'halfDay';

  // Drag-to-dismiss: a downward drag on the handle/header translates the
  // sheet, and on release we either snap back to 0 or animate it offscreen
  // and close. Native driver keeps the gesture at 60fps even while the
  // model is busy generating.
  const dragY = useRef(new Animated.Value(0)).current;
  const screenHeight = Dimensions.get('window').height;
  const dragResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
        onPanResponderMove: (_e, g) => {
          if (g.dy > 0) dragY.setValue(g.dy);
        },
        onPanResponderRelease: (_e, g) => {
          const shouldClose = g.dy > 120 || g.vy > 1.2;
          if (shouldClose) {
            Animated.timing(dragY, {
              toValue: screenHeight,
              duration: 180,
              useNativeDriver: true,
            }).start(() => {
              // Don't reset dragY here — that would snap the sheet back to
              // its open translateY=0 for a frame before Modal's own slide-
              // out animation kicks in, producing the flicker the user
              // reported (sheet briefly reappears before disappearing).
              // Instead leave dragY at screenHeight so the sheet stays
              // offscreen until onClose flips visible=false; the
              // visible-effect below resets dragY to 0 the next time the
              // modal is reopened, before any frame is rendered.
              onClose();
            });
          } else {
            Animated.spring(dragY, {
              toValue: 0,
              useNativeDriver: true,
              tension: 80,
              friction: 10,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        },
      }),
    [dragY, onClose, screenHeight]
  );

  // Reset translation when the sheet is reopened so a previous drag-down
  // doesn't leak into the next session.
  useEffect(() => {
    if (visible) dragY.setValue(0);
  }, [visible, dragY]);

  // Determine header strip content.
  const hasOsrmLeg = routeLegs?.some((l) => l.source === 'osrm') ?? false;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      hardwareAccelerated
    >
      {/*
        Sibling-backdrop layout: the dimmed Pressable lives behind the sheet
        as a separate sibling rather than wrapping it. The previous structure
        wrapped the sheet inside the Pressable and used a JS responder hijack
        on the sheet to block backdrop presses; that hijack also swallowed
        all native gesture events, breaking the inner ScrollView (which felt
        sluggish or didn't scroll at all). With siblings the sheet renders on
        top via absolute positioning, the ScrollView gets normal native
        scroll handling, and tapping outside the sheet still closes it.
      */}
      <View style={styles.modalRoot}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: Spacing.lg + insets.bottom },
            { transform: [{ translateY: dragY }] },
          ]}
        >
          {/* flex: 1 column so the ScrollView expands to fill remaining height */}
          <View style={styles.sheetInner}>
          <View style={styles.handleArea} {...dragResponder.panHandlers}>
            <View style={styles.handle} />
            <Text style={styles.heading}>{t(`itinerary.${durationLabel}`)}</Text>
            <Text style={styles.sub}>{t('itinerary.pickDuration')}</Text>
          </View>

          {planSource === 'ai-offline' && (
            <View style={styles.sourceStripOffline}>
              <Text style={styles.sourceStripText}>
                ⚠ Generated offline — verify before relying on it
              </Text>
            </View>
          )}
          {planSource === 'wikipedia' && (
            <View style={styles.sourceStripWikipedia}>
              <Text style={styles.sourceStripText}>From Wikipedia</Text>
            </View>
          )}

          {/* Route header strip — shown once the plan exists */}
          {stops.length > 0 && (
            <View style={styles.routeStrip}>
              {routeOptimising ? (
                <Text style={styles.routeStripText}>Optimising route…</Text>
              ) : routeLegs !== null ? (
                <Text style={styles.routeStripText}>
                  {hasOsrmLeg
                    ? `≈ ${routeTotalMin} min walking · ${formatDistance(routeTotalM, units)}`
                    : `≈ ${formatDistance(routeTotalM, units)}`}
                </Text>
              ) : null}
            </View>
          )}

          <View style={styles.chipsRow}>
            {DURATIONS.map((d) => (
              <PillowChip
                key={d.hours}
                label={t(`itinerary.${d.labelKey}`)}
                active={duration === d.hours}
                onPress={() => setDuration(d.hours)}
              />
            ))}
          </View>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            // nestedScrollEnabled lets the list scroll independently of the
            // sheet's own drag-to-dismiss gesture on Android. Without this,
            // a downward swipe inside the list area was sometimes captured
            // by the parent and the user couldn't reach later stops on a
            // full-day plan.
            nestedScrollEnabled
          >
            {loading && stops.length === 0 && (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={Colors.secondary} />
                <Text style={styles.loadingText}>{t('itinerary.generating')}</Text>
              </View>
            )}

            {error && !loading && <Text style={styles.error}>{error}</Text>}

            {/*
              Per-stop cards with optional inter-card walking-time labels.
              "→ N min walk" is shown between consecutive cards only when the
              leg came from OSRM (real street routing). Haversine-fallback legs
              are suppressed so we never show a number that's potentially 2× off
              on hilly or non-grid streets. The routing is now powered by the
              OSRM public demo server (OpenStreetMap, free, no API key) which
              surfaces actual walkable paths — no more routing through buildings
              or across San Francisquito Creek without a bridge.
            */}
            {enrichedStops.map(({ stop, poi }, i) => {
              const visited = visitedTitles[stop.title.trim().toLowerCase()] === true;
              const leg = routeLegs && i > 0 ? routeLegs[i] : null;
              return (
                <React.Fragment key={`${i}-${stop.title}`}>
                  {/* Inter-card walking-time label (only for OSRM legs, between cards) */}
                  {leg && leg.source === 'osrm' && (
                    <View style={styles.legLabel}>
                      <Text style={styles.legLabelText}>→ {leg.minutes} min walk</Text>
                    </View>
                  )}
                  <Pressable
                    style={({ pressed }) => [
                      styles.stopCard,
                      visited && styles.stopCardVisited,
                      pressed && styles.stopCardPressed,
                    ]}
                    onPress={() => onChatAboutStop?.(stop.title)}
                  >
                    <Text style={[styles.stopIndex, visited && styles.stopIndexVisited]}>
                      {i + 1}
                    </Text>
                    <View style={styles.stopBody}>
                      <Text
                        style={[styles.stopTitle, visited && styles.stopTitleVisited]}
                      >
                        {stop.title}
                      </Text>
                      {stop.note ? <Text style={styles.stopNote}>{stop.note}</Text> : null}
                    </View>
                    {/*
                      Hit-slop on the checkbox so a fingertip-sized tap reliably
                      toggles the visited state without firing the card's own
                      onPress (which would open chat). The checkbox stops touch
                      propagation via its own Pressable.
                    */}
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: visited }}
                      hitSlop={10}
                      onPress={() => visitedStore.setVisited(stop.title, !visited)}
                      style={[styles.checkbox, visited && styles.checkboxChecked]}
                    >
                      {visited ? <Text style={styles.checkmark}>✓</Text> : null}
                    </Pressable>
                  </Pressable>
                </React.Fragment>
              );
            })}
          </ScrollView>

          {/*
            CTA visibility rules per user request:
            - If the current duration already has a generated plan, hide
              the button entirely. The plan is the result; no re-plan
              needed unless the user explicitly switches durations.
            - If we're generating, hide the button (the loading spinner
              inside the list area communicates progress).
            - Show the button only when the sheet is empty: either the
              user just switched to a duration we haven't planned yet
              and somehow the auto-plan didn't fire (e.g. no location),
              or generation errored out and the user wants to retry.
          */}
          {!loading && stops.length === 0 && (
            <View style={styles.footer}>
              <TouchableOpacity style={styles.cta} onPress={() => plan(duration)}>
                <Text style={styles.ctaLabel}>{t('itinerary.button')}</Text>
              </TouchableOpacity>
            </View>
          )}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Root container holds the absolute-fill backdrop Pressable and the sheet
  // as siblings. justifyContent: flex-end pushes the sheet to the bottom.
  modalRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  // Match QuizModal exactly: an explicit `height: '85%'` forces the sheet
  // up to the same height regardless of content; without it the itinerary
  // sheet collapsed to content size and felt sluggish/short on tall
  // phones. The `maxHeight: Sizing.vh(90)` belt-and-braces guards against
  // the sheet growing past the viewport on split screen / very tall
  // devices. paddingBottom is applied inline (insets.bottom) so the CTA
  // never disappears under gesture-nav.
  sheet: {
    height: '85%',
    maxHeight: Sizing.vh(90),
    backgroundColor: Colors.background,
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    ...Shadows.softFloating,
  },
  // Full-height flex column so the ScrollView inside gets all remaining
  // space after the handle, heading, and chip row. Without flex: 1 the
  // ScrollView collapses to content height and the last items are clipped.
  sheetInner: {
    flex: 1,
  },
  // Tall enough to be an easy grab target on touch.
  handleArea: {
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.xs,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  heading: {
    ...Type.h1,
    color: Colors.text,
  },
  sub: {
    ...Type.bodySm,
    color: Colors.textSecondary,
    marginTop: 4,
    marginBottom: Spacing.md,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: Spacing.md,
  },
  footer: {
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    marginTop: Spacing.sm,
  },
  cta: {
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    borderRadius: Radii.md,
    alignItems: 'center',
    ...Shadows.ctaHard,
  },
  ctaLabel: {
    ...Type.button,
    color: '#FFFFFF',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: Spacing.md,
  },
  loadingText: {
    ...Type.bodySm,
    color: Colors.textSecondary,
  },
  error: {
    ...Type.bodySm,
    color: Colors.error,
    marginTop: Spacing.md,
  },
  list: {
    flex: 1,
    marginTop: Spacing.xs,
  },
  listContent: {
    gap: 10,
    // Extra bottom padding so the last stop card clears the gesture-nav bar
    // and any visible CTA footer. Spacing.xl ≈ 32 dp is enough on all
    // common Android gesture-bar heights.
    paddingBottom: Spacing.xl,
  },
  stopCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    padding: 12,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  // Visited cards fade slightly so the unvisited ones stand out as the
  // remaining work; we keep the same border so the row's footprint is
  // stable as the user toggles state.
  stopCardVisited: {
    backgroundColor: Colors.borderLight,
    opacity: 0.7,
  },
  // Tactile feedback while the user is pressing — subtle dim, no scale,
  // since the card sits inside a scrollable list and a transform would
  // feel jumpy under flicks.
  stopCardPressed: {
    opacity: 0.6,
  },
  stopBody: {
    flex: 1,
  },
  stopIndex: {
    ...Type.h1,
    color: Colors.primary,
    width: 24,
    textAlign: 'center',
  },
  stopIndexVisited: {
    color: Colors.textTertiary,
  },
  stopTitle: {
    ...Type.poi,
    color: Colors.text,
  },
  stopTitleVisited: {
    textDecorationLine: 'line-through',
    color: Colors.textSecondary,
  },
  stopNote: {
    ...Type.bodySm,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  // Square checkbox; sized for a comfortable thumb tap and visually
  // matches the card's border treatment so it reads as part of the row.
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: Radii.sm,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  checkboxChecked: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary,
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 20,
  },
  sourceStripOffline: {
    backgroundColor: '#FFF3CD',
    borderRadius: Radii.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    marginBottom: Spacing.sm,
  },
  sourceStripWikipedia: {
    backgroundColor: Colors.surface,
    borderRadius: Radii.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    marginBottom: Spacing.sm,
  },
  sourceStripText: {
    ...Type.bodySm,
    color: Colors.textSecondary,
  },
  // Route header strip: shows total walking time/distance or "Optimising route…"
  routeStrip: {
    backgroundColor: Colors.secondaryLight,
    borderRadius: Radii.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    marginBottom: Spacing.sm,
  },
  routeStripText: {
    ...Type.bodySm,
    color: Colors.secondary,
  },
  // Inter-card walking-time label: small, muted, between stop cards.
  legLabel: {
    alignItems: 'center',
    marginVertical: -2,
  },
  legLabelText: {
    ...Type.hint,
    color: Colors.textTertiary,
    opacity: 0.85,
  },
});
