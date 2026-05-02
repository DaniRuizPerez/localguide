import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppMode } from '../hooks/useAppMode';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { Colors } from '../theme/colors';
import { Sizing, Type } from '../theme/tokens';
import { t } from '../i18n';

interface Props {
  /** Called when the pill is tapped. When omitted the pill is non-interactive. */
  onPress?: () => void;
}

/**
 * Soft-tactile connectivity pill rendered in ChatHeader.
 * Shows the effective connectivity mode: online (green dot), offline (amber
 * dot), or probing (grey dot). Tap to open the "How should I answer?" sheet
 * (Ticket 3 wires the handler; here we just expose the `onPress` prop).
 *
 * Visual spec: padding 5/11, borderRadius 14, inset shadow peach/white,
 * dot 6×6 borderRadius 3, text Nunito 700 / fontSize 10.
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
    dotColor = Colors.success; // #4ea374
    label = t('mode.online');
  } else {
    dotColor = Colors.warning; // amber
    label = t('mode.offline');
  }

  const pillBody = (
    <View style={styles.pill} testID="connection-pill-body">
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text
        style={[Type.metaUpper, styles.label]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        testID="connection-pill"
      >
        {pillBody}
      </Pressable>
    );
  }

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      testID="connection-pill"
    >
      {pillBody}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 14,
    gap: 6,
    flexShrink: 0,
    maxWidth: Sizing.vw(28),
    // Inset shadow — approximated on iOS via shadowColor/offset/opacity and on
    // Android via a subtle elevation-0 (inset shadows are not native on Android
    // but the surface colour + border give the same depth read at small sizes).
    shadowColor: 'rgba(184,98,58,1)',
    shadowOffset: { width: 2, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 0,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
  label: {
    color: Colors.textSecondary,
  },
});
