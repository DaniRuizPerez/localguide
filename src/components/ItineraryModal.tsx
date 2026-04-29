import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
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
  const [duration, setDuration] = useState<number>(4);
  const [stops, setStops] = useState<ItineraryStop[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTask, setActiveTask] = useState<ItineraryTask | null>(null);

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

  const plan = useCallback(() => {
    if (!location) return;
    if (activeTask) activeTask.abort();
    setStops([]);
    setError(null);
    setLoading(true);
    const task = localGuideService.planItinerary(location, duration, nearbyTitles);
    setActiveTask(task);
    task.promise
      .then((result) => {
        setStops(result);
        if (result.length === 0) setError(t('itinerary.empty'));
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
        setActiveTask(null);
      });
  }, [location, duration, nearbyTitles, activeTask]);

  // Abort in-flight request when the user dismisses the modal.
  useEffect(() => {
    if (!visible && activeTask) {
      activeTask.abort();
      setActiveTask(null);
    }
  }, [visible, activeTask]);

  const durationLabel = DURATIONS.find((d) => d.hours === duration)?.labelKey ?? 'halfDay';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: Spacing.lg + insets.bottom }]}
          onPress={() => {}}
        >
          <View style={styles.handle} />
          <Text style={styles.heading}>{t(`itinerary.${durationLabel}`)}</Text>
          <Text style={styles.sub}>{t('itinerary.pickDuration')}</Text>

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

          <TouchableOpacity
            style={[styles.cta, loading && styles.ctaDisabled]}
            onPress={plan}
            disabled={loading}
          >
            <Text style={styles.ctaLabel}>{t('itinerary.button')}</Text>
          </TouchableOpacity>

          {loading && (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={Colors.secondary} />
              <Text style={styles.loadingText}>{t('itinerary.generating')}</Text>
            </View>
          )}

          {error && !loading && (
            <Text style={styles.error}>{error}</Text>
          )}

          <ScrollView style={styles.list} contentContainerStyle={{ gap: 10 }}>
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
        </Pressable>
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
  sheet: {
    // Percentage-of-viewport caps so the sheet adapts to phone size; bottom
    // padding is added inline at render time using `useSafeAreaInsets()` so
    // the trailing CTA never disappears under gesture-nav.
    maxHeight: Sizing.vh(85),
    minHeight: Sizing.vh(40),
    backgroundColor: Colors.background,
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    ...Shadows.softFloating,
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
  cta: {
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    borderRadius: Radii.md,
    alignItems: 'center',
    ...Shadows.ctaHard,
  },
  ctaDisabled: {
    opacity: 0.6,
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
    marginTop: Spacing.md,
    flexShrink: 1,
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
