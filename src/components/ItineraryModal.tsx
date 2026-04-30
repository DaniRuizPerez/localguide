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
  type ItineraryStop,
  type ItineraryTask,
} from '../services/LocalGuideService';
import type { GPSContext } from '../services/InferenceService';
import { distanceMeters, type Poi } from '../services/PoiService';
import { visitedStore } from '../services/VisitedStore';

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

// NN + 2-opt route optimisation over an arbitrary set of geo-points starting
// from `start`. Used twice: once pre-LLM to feed candidates in a sensible
// order, and once post-LLM to reorder whatever stops the model picked back
// into a coherent route. Without the post-LLM pass the model's "best visit
// order" instruction is unreliable — Gemma typically lists candidates in the
// order it processed them, ignoring spatial layout, which produced the
// "Palo Alto → Menlo Park → Stanford" loop the user originally reported.
function optimizeWalkingOrder<T extends { latitude: number; longitude: number }>(
  start: { latitude: number; longitude: number },
  items: T[]
): T[] {
  if (items.length < 2) return [...items];

  // Step 1: greedy nearest-neighbor.
  const remaining = [...items];
  let ordered: T[] = [];
  let cur = start;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = distanceMeters(cur.latitude, cur.longitude, remaining[0].latitude, remaining[0].longitude);
    for (let i = 1; i < remaining.length; i++) {
      const d = distanceMeters(cur.latitude, cur.longitude, remaining[i].latitude, remaining[i].longitude);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const chosen = remaining.splice(bestIdx, 1)[0];
    ordered.push(chosen);
    cur = chosen;
  }

  // Step 2: 2-opt sweeps. Open tour (no return), so only the two edges
  // adjacent to the reversed subsegment change weight. 1 m hysteresis
  // prevents float ping-pong; safety counter bounds total sweeps.
  const edgeAt = (a: number, b: number): number => {
    const A = a === -1 ? start : ordered[a];
    const B = ordered[b];
    return distanceMeters(A.latitude, A.longitude, B.latitude, B.longitude);
  };
  let improved = true;
  let safety = 30;
  while (improved && safety-- > 0) {
    improved = false;
    for (let i = 0; i < ordered.length - 1; i++) {
      for (let j = i + 1; j < ordered.length; j++) {
        const before =
          edgeAt(i - 1, i) + (j + 1 < ordered.length ? edgeAt(j, j + 1) : 0);
        const after =
          edgeAt(i - 1, j) + (j + 1 < ordered.length ? edgeAt(i, j + 1) : 0);
        if (after + 1 < before) {
          ordered = [
            ...ordered.slice(0, i),
            ...ordered.slice(i, j + 1).reverse(),
            ...ordered.slice(j + 1),
          ];
          improved = true;
        }
      }
    }
  }
  return ordered;
}

export function ItineraryModal({
  visible,
  onClose,
  location,
  nearbyPois,
  onChatAboutStop,
}: Props) {
  const insets = useSafeAreaInsets();

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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Tracked in a ref so the visibility/cleanup effects always see the live
  // task, not a stale state snapshot.
  const taskRef = useRef<ItineraryTask | null>(null);

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

  // Route-optimised candidate list fed to the LLM as visit-order hints.
  // Only POIs with real coordinates are routed; LLM-sourced entries keep
  // their original order at the end because they carry placeholder coords
  // (the user's own position) that would dominate any distance calculation.
  // Capped at 12 entries — the prompt only sends 12 titles anyway.
  const nearbyTitles = useMemo(() => {
    const realPois = nearbyPois.filter((p) => p.source !== 'llm').slice(0, 12);
    const llmPois = nearbyPois.filter((p) => p.source === 'llm');
    const ordered = startCoord ? optimizeWalkingOrder(startCoord, realPois) : realPois;
    return [...ordered, ...llmPois].map((p) => p.title).slice(0, 12);
  }, [nearbyPois, startCoord]);

  // Match each generated stop to a real POI (by exact title) so we can
  // compute walking-time hints between consecutive stops when possible —
  // and, more importantly, reorder the LLM's pick into a coherent walking
  // route. Gemma usually lists the candidates back in the order it
  // processed them, ignoring the "best visit order" instruction; without
  // this post-pass the user sees the original zigzag (e.g. PA → MP →
  // Stanford instead of PA → Stanford → MP).
  const enrichedStops = useMemo(() => {
    const byTitle = new Map<string, Poi>();
    for (const poi of nearbyPois) {
      byTitle.set(poi.title.toLowerCase(), poi);
    }
    const enriched = stops.map((s) => ({
      stop: s,
      poi: byTitle.get(s.title.toLowerCase()) ?? null,
    }));

    // Without a GPS start or fewer than two matched stops, there's
    // nothing to reorder — pass through.
    if (!startCoord) return enriched;
    const matched = enriched.filter(
      (e): e is { stop: ItineraryStop; poi: Poi } => e.poi !== null
    );
    const unmatched = enriched.filter((e) => e.poi === null);
    if (matched.length < 2) return enriched;

    // optimizeWalkingOrder operates on objects with latitude/longitude;
    // we wrap each matched entry so the helper can sort it directly.
    const reordered = optimizeWalkingOrder(
      startCoord,
      matched.map((m) => ({ ...m, latitude: m.poi.latitude, longitude: m.poi.longitude }))
    ).map(({ stop, poi }) => ({ stop, poi }));

    // Unmatched stops (LLM hallucinated names not in the real-POI set)
    // can't be routed; keep them at the end in their original relative
    // order so we don't drop information.
    return [...reordered, ...unmatched];
  }, [stops, nearbyPois, startCoord]);

  const plan = (hours: number) => {
    if (!location) return;
    taskRef.current?.abort();
    setPlans((prev) => {
      // Clear only THIS duration's cache so a re-plan starts from a clean
      // empty list; other durations keep their previously-generated plans.
      const next = new Map(prev);
      next.delete(hours);
      return next;
    });
    setError(null);
    setLoading(true);
    const task = localGuideService.planItinerary(location, hours, nearbyTitles);
    taskRef.current = task;
    task.promise
      .then((result) => {
        // Drop late results from a superseded request.
        if (taskRef.current !== task) return;
        if (result.length === 0) {
          setError(t('itinerary.empty'));
          return;
        }
        setPlans((prev) => {
          const next = new Map(prev);
          next.set(hours, result);
          return next;
        });
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
    setLoading(false);
    setError(null);
  }, [visible]);

  // Hard cleanup on unmount.
  useEffect(
    () => () => {
      taskRef.current?.abort();
      taskRef.current = null;
    },
    []
  );

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
              We deliberately don't show a between-stops walking-time hint:
              the great-circle/constant-speed estimate we'd compute is just
              a guess. A real "N min walk" needs a routing API, which we
              only have when online — and even then we haven't wired one
              up yet. Leaving it out is more honest than showing a number
              that's frequently wrong by 2x on hilly or non-grid streets.
            */}
            {enrichedStops.map(({ stop, poi }, i) => {
              const visited = visitedTitles[stop.title.trim().toLowerCase()] === true;
              return (
                <Pressable
                  key={`${i}-${stop.title}`}
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
});
