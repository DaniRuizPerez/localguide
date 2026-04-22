import React from 'react';
import { ScrollView, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { PillowChip } from './PillowChip';
import { Colors } from '../theme/colors';
import { t } from '../i18n';
import type { GuideTopic } from '../services/LocalGuideService';

export type { GuideTopic };

// Emoji stays per-topic; label is resolved at render time via i18n.
const TOPIC_EMOJI: Record<GuideTopic, string> = {
  everything: '✨',
  history: '🏛',
  nature: '🌿',
  geography: '🗺',
  food: '🍽',
  culture: '🎭',
};

const TOPIC_ORDER: GuideTopic[] = ['everything', 'history', 'nature', 'geography', 'food', 'culture'];

export const TOPIC_OPTIONS: { id: GuideTopic; emoji: string }[] = TOPIC_ORDER.map((id) => ({
  id,
  emoji: TOPIC_EMOJI[id],
}));

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
      keyboardShouldPersistTaps="handled"
    >
      {TOPIC_OPTIONS.map((topic) => (
        <PillowChip
          key={topic.id}
          label={`${topic.emoji} ${t(`topics.${topic.id}` as const)}`}
          active={topic.id === selected}
          onPress={() => onSelect(topic.id)}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: Colors.background,
  },
  row: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
  },
});
