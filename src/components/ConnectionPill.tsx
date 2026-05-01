import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppMode } from '../hooks/useAppMode';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { Colors } from '../theme/colors';
import { Radii, Shadows, Sizing, Type } from '../theme/tokens';
import { t } from '../i18n';

interface Props {
  onPress: () => void;
}

/**
 * Tiny pill rendered to the left of the location pill in ChatHeader.
 * Shows the effective connectivity mode (online / offline / probing).
 * Tapping opens the settings sheet (same target as the gear icon).
 */
export function ConnectionPill({ onPress }: Props) {
  const { effective } = useAppMode();
  const network = useNetworkStatus();

  // Probing state: effective is online (optimistic) but network still unknown.
  const isProbing = effective === 'online' && network === 'unknown';

  let dotColor: string;
  let label: string;

  if (isProbing) {
    dotColor = Colors.textTertiary;
    label = t('mode.unknownProbing');
  } else if (effective === 'online') {
    dotColor = Colors.success;
    label = t('mode.online');
  } else {
    dotColor = Colors.warning;
    label = t('mode.offline');
  }

  return (
    <TouchableOpacity
      style={styles.pill}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID="connection-pill"
    >
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text style={[Type.metaUpper, { color: Colors.textSecondary }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: 6,
    flexShrink: 0,
    maxWidth: Sizing.vw(28),
    ...Shadows.softOutset,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
});
