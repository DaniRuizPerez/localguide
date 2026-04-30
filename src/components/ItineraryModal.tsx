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

interface Props {
  visible: boolean;
  onClose: () => void;
  location: GPSContext | string | null;
  nearbyPois: Poi[];
}

const DURATIONS: Array<{ hours: number; labelKey: 'oneHour' | 'halfDay' | 'fullDay' }> = [
  { hours: 1, labelKey: 'oneHour' },
  { hours: 4, labelKey: 'halfDay' },
  { hours: 8, labelKey: 'fullDay' },
];

const DEFAULT_HOURS = 4;

// Rough pedestrian speed — ~5 km/h = ~83 m/min. Used for "N min between stops"
// hints between consecutive itinerary items that we can match to real POIs.
const WALKING_METERS_PER_MIN = 83;

function minutesBetween(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const meters = distanceMeters(a.latitude, a.longitude, b.latitude, b.longitude);
  return Math.max(1, Math.round(meters / WALKING_METERS_PER_MIN));
}

export function ItineraryModal({ visible, onClose, location, nearbyPois }: Props) {
  const insets = useSafeAreaInsets();
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

  const nearbyTitles = useMemo(
    () => nearbyPois.map((p) => p.title).slice(0, 12),
    [nearbyPois]
  );

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
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: Spacing.lg + insets.bottom },
            { transform: [{ translateY: dragY }] },
          ]}
          // Block backdrop press from firing when interacting with the sheet.
          onStartShouldSetResponder={() => true}
        >
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

            {enrichedStops.map(({ stop, poi }, i) => {
              const prev = i > 0 ? enrichedStops[i - 1]?.poi : null;
              const walkMin = prev && poi ? minutesBetween(prev, poi) : null;
              return (
                <View key={`${i}-${stop.title}`}>
                  {walkMin != null && (
                    <Text style={styles.walkHint}>
                      ↓ {t('itinerary.walkMinutes', { minutes: walkMin })}
                    </Text>
                  )}
                  <View style={styles.stopCard}>
                    <Text style={styles.stopIndex}>{i + 1}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.stopTitle}>{stop.title}</Text>
                      {stop.note ? <Text style={styles.stopNote}>{stop.note}</Text> : null}
                    </View>
                  </View>
                </View>
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
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
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
    paddingBottom: Spacing.md,
  },
  stopCard: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: Colors.surface,
    padding: 12,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  stopIndex: {
    ...Type.h1,
    color: Colors.primary,
    width: 24,
    textAlign: 'center',
  },
  stopTitle: {
    ...Type.poi,
    color: Colors.text,
  },
  stopNote: {
    ...Type.bodySm,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  walkHint: {
    ...Type.metaUpper,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginBottom: 4,
  },
});
