import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Colors } from '../theme/colors';
import { Radii, Shadows, Type } from '../theme/tokens';
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

// Non-"everything" topics in display order — the set the user toggles
// individually when Everything is off.
const SPECIFIC_TOPICS: GuideTopic[] = TOPIC_ORDER.filter((id) => id !== 'everything');

/**
 * Multi-select topic toggles. Layout is a wrapping grid, not a horizontal
 * strip — the user can see every topic at once inside the settings sheet.
 *
 * Selection rules:
 *   - 'everything' is a meta-topic: when on, every specific topic also
 *     appears selected (dim + uninteractable) and the caller's `selected`
 *     prop is effectively ignored for them.
 *   - Toggling 'everything' on clears any specific selections and stores
 *     `['everything']` — downstream prompt-building treats that as "no
 *     focus bias".
 *   - Toggling 'everything' off leaves an empty selection so the user can
 *     pick freely; prompt-building still treats `[]` as "no focus bias".
 */
export function TopicChips({
  selected,
  onChange,
  style,
}: {
  selected: readonly GuideTopic[];
  onChange: (next: GuideTopic[]) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const everythingOn = selected.includes('everything');

  const toggle = (id: GuideTopic) => {
    if (id === 'everything') {
      onChange(everythingOn ? [] : ['everything']);
      return;
    }
    if (everythingOn) return; // locked while Everything is on
    const isOn = selected.includes(id);
    onChange(isOn ? selected.filter((s) => s !== id) : [...selected, id]);
  };

  return (
    <View style={[styles.grid, style]}>
      {TOPIC_OPTIONS.map(({ id, emoji }) => {
        const isEverything = id === 'everything';
        const active = isEverything ? everythingOn : everythingOn || selected.includes(id);
        // Specific topics are visually-on-but-locked while Everything is on.
        const locked = !isEverything && everythingOn;
        return (
          <Pressable
            key={id}
            onPress={() => toggle(id)}
            disabled={locked}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled: locked }}
            accessibilityLabel={t(`topics.${id}` as const)}
            style={[
              styles.chip,
              active && styles.chipActive,
              locked && styles.chipLocked,
            ]}
          >
            <Text style={[Type.chip, styles.label, active && styles.labelActive]}>
              {emoji} {t(`topics.${id}` as const)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  chipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
    ...Shadows.chipActiveHalo,
  },
  chipLocked: {
    // Dim so the user knows these are implied by "Everything" and can't be
    // individually toggled until Everything is flipped off.
    opacity: 0.45,
  },
  label: {
    color: Colors.textSecondary,
  },
  labelActive: {
    color: '#FFFFFF',
  },
});
