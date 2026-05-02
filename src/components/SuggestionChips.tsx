import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors } from '../theme/colors';
import { Fonts } from '../theme/tokens';

export interface Chip {
  label: string;
  onPress: () => void;
}

interface Props {
  chips: Chip[];
}

/**
 * Horizontal row of soft-tactile suggestion pills rendered beneath a guide
 * bubble. Every guide bubble gets its own chip row (not just the latest) so
 * the user can dig deeper into any earlier topic at any time.
 */
export function SuggestionChips({ chips }: Props) {
  if (chips.length === 0) return null;

  return (
    <View style={styles.container}>
      {chips.map((chip) => (
        <Pressable
          key={chip.label}
          onPress={chip.onPress}
          testID={`suggestion-chip-${chip.label}`}
          android_ripple={{ color: 'rgba(78,163,116,0.15)', borderless: false }}
          style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
          accessibilityRole="button"
          accessibilityLabel={chip.label}
        >
          <Text style={styles.chipText}>{chip.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    paddingLeft: 40,
    // Small top gap so chips sit snugly beneath the bubble row above them.
    marginTop: 2,
    // Bottom margin compensates for the gap that MessageList's FlatList
    // already adds between items.
    marginBottom: 4,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 11,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(78,163,116,0.25)',
  },
  chipPressed: {
    opacity: 0.75,
  },
  chipText: {
    fontFamily: Fonts.sansBold,
    fontSize: 9.5,
    lineHeight: 13,
    color: Colors.secondary,
  },
});
