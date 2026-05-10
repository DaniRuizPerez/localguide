import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppMode } from '../hooks/useAppMode';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { Colors } from '../theme/colors';
import { Type } from '../theme/tokens';
import { t } from '../i18n';

interface Props {
  /** Called when the pill is tapped. When omitted the pill is non-interactive. */
  onPress?: () => void;
}

/**
 * Connectivity status indicator rendered in ChatHeader.
 * Renders a coloured label + a 36×20 track with a 14×14 white puck whose
 * position encodes the state: right=online, left=offline, centred=probing.
 * Label colour matches the active state. Tap to open the
 * "How should I answer?" sheet.
 */
export function ConnectionPill({ onPress }: Props) {
  const { effective } = useAppMode();
  const network = useNetworkStatus();

  // Probing state: effective is online (optimistic) but network still unknown.
  const isProbing = effective === 'online' && network === 'unknown';

  let label: string;
  let labelColor: string;
  let trackBg: string;
  let trackBorder: string;
  let puckStyle: { left?: number; right?: number };
  let a11yLabel: string;

  if (isProbing) {
    label = t('mode.unknownProbing');
    labelColor = Colors.textTertiary;
    trackBg = Colors.surface;
    trackBorder = Colors.borderLight;
    puckStyle = { left: 11 };
    a11yLabel = label;
  } else if (effective === 'online') {
    label = t('mode.online');
    labelColor = Colors.success;
    trackBg = Colors.successLight;
    trackBorder = 'rgba(78,163,116,0.35)';
    puckStyle = { right: 2 };
    a11yLabel = 'Online mode';
  } else {
    label = t('mode.offline');
    labelColor = Colors.warning;
    trackBg = Colors.warningLight;
    trackBorder = 'rgba(216,139,42,0.45)';
    puckStyle = { left: 2 };
    a11yLabel = 'Offline mode';
  }

  const pillBody = (
    <View style={styles.row} testID="connection-pill-body">
      <Text style={[Type.metaUpper, { color: labelColor }]} numberOfLines={1}>
        {label}
      </Text>
      <View style={[styles.track, { backgroundColor: trackBg, borderColor: trackBorder }]}>
        <View style={[styles.puck, puckStyle]} />
      </View>
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        testID="connection-pill"
      >
        {pillBody}
      </Pressable>
    );
  }

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={a11yLabel}
      testID="connection-pill"
    >
      {pillBody}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  track: {
    width: 36,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    position: 'relative',
  },
  puck: {
    position: 'absolute',
    top: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#FFFFFF',
  },
});
