import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../theme/colors';
import { Radii, Shadows, Sizing, Spacing, Type } from '../theme/tokens';
import { t } from '../i18n';
import {
  localGuideService,
  type TimelineEvent,
  type TimelineTask,
} from '../services/LocalGuideService';
import type { GPSContext } from '../services/InferenceService';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** POI title, null when nothing selected (modal stays inert). */
  poiTitle: string | null;
  location: GPSContext | string | null;
}

export function TimelineModal({ visible, onClose, poiTitle, location }: Props) {
  const insets = useSafeAreaInsets();
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<TimelineTask | null>(null);

  useEffect(() => {
    if (!visible || !poiTitle) return;
    setEvents([]);
    setError(null);
    setLoading(true);
    const task = localGuideService.buildTimeline(poiTitle, location);
    setActiveTask(task);
    task.promise
      .then((res) => {
        setEvents(res);
        if (res.length === 0) setError(t('timeline.empty'));
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
        setActiveTask(null);
      });
    return () => {
      task.abort();
    };
  }, [visible, poiTitle, location]);

  useEffect(() => {
    if (!visible && activeTask) {
      activeTask.abort();
      setActiveTask(null);
    }
  }, [visible, activeTask]);

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
          <Text style={styles.heading}>{t('timeline.title')}</Text>
          {poiTitle ? <Text style={styles.subheading}>{poiTitle}</Text> : null}

          {loading && (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={Colors.secondary} />
              <Text style={styles.loadingText}>{t('timeline.generating')}</Text>
            </View>
          )}

          {error && !loading && <Text style={styles.error}>{error}</Text>}

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {events.map((e, i) => (
              <View key={`${i}-${e.year}`} style={styles.row}>
                <View style={styles.rail}>
                  <View style={[styles.dot, i === 0 && styles.dotFirst]} />
                  {i < events.length - 1 && <View style={styles.line} />}
                </View>
                <View style={styles.card}>
                  <Text style={styles.year}>{e.year}</Text>
                  <Text style={styles.event}>{e.event}</Text>
                </View>
              </View>
            ))}
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
    // Cap to a percentage of viewport height so this works on every screen
    // size; bottom padding is added inline to honour the safe-area inset.
    maxHeight: Sizing.vh(85),
    minHeight: Sizing.vh(35),
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
  subheading: {
    ...Type.bodySm,
    color: Colors.textSecondary,
    marginTop: 2,
    marginBottom: Spacing.md,
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
    marginTop: Spacing.sm,
    flexShrink: 1,
  },
  listContent: {
    paddingBottom: Spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  rail: {
    alignItems: 'center',
    width: 20,
    paddingTop: 6,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.primary,
    borderWidth: 2,
    borderColor: Colors.surface,
  },
  dotFirst: {
    backgroundColor: Colors.secondary,
  },
  line: {
    flex: 1,
    width: 2,
    backgroundColor: Colors.border,
    marginTop: 2,
    marginBottom: 2,
  },
  card: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radii.md,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  year: {
    ...Type.poi,
    color: Colors.primary,
  },
  event: {
    ...Type.bodySm,
    color: Colors.text,
    marginTop: 4,
  },
});
