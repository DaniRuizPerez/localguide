import React from 'react';
import { ScrollView, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { PillowChip } from './PillowChip';
import { Colors } from '../theme/colors';
import type { GuideTopic } from '../services/LocalGuideService';

export type { GuideTopic };

export const TOPIC_OPTIONS: { id: GuideTopic; emoji: string; label: string }[] = [
  { id: 'everything', emoji: '✨', label: 'Everything' },
  { id: 'history', emoji: '🏛', label: 'History' },
  { id: 'nature', emoji: '🌿', label: 'Nature' },
  { id: 'geography', emoji: '🗺', label: 'Geography' },
  { id: 'food', emoji: '🍽', label: 'Food' },
  { id: 'culture', emoji: '🎭', label: 'Culture' },
];

export function TopicChips({
  selected,
  onSelect,
  style,
}: {
  selected: GuideTopic;
  onSelect: (topic: GuideTopic) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.scroll, style]}
      contentContainerStyle={styles.row}
    >
      {TOPIC_OPTIONS.map((t) => (
        <PillowChip
          key={t.id}
          label={`${t.emoji} ${t.label}`}
          active={t.id === selected}
          onPress={() => onSelect(t.id)}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 0,
    backgroundColor: Colors.background,
  },
  row: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
});
