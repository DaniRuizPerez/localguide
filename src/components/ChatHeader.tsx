import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '../theme/colors';
import { Radii, Shadows, Type } from '../theme/tokens';
import { t } from '../i18n';
import type { GPSContext } from '../services/InferenceService';

interface Props {
  status: string;
  gps: GPSContext | null;
  manualLocation: string | null;
  onIdentifyPress: () => void;
  onSettingsPress: () => void;
  /** Disables the camera CTA while an inference is in flight. */
  busy: boolean;
}

function LocationPill({
  status,
  gps,
  manualLocation,
}: {
  status: string;
  gps: GPSContext | null;
  manualLocation: string | null;
}) {
  let name = t('chat.locating');
  let dotColor: string = Colors.warning;
  if (status === 'ready' && gps) {
    name = gps.placeName ?? `${gps.latitude.toFixed(3)}, ${gps.longitude.toFixed(3)}`;
    dotColor = Colors.success;
  } else if (manualLocation) {
    name = manualLocation;
    dotColor = Colors.warning;
  } else if (status === 'denied' || status === 'error') {
    name = t('chat.noGps');
    dotColor = Colors.error;
  }
  return (
    <View style={styles.locationPill}>
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text style={[Type.metaUpper, { color: Colors.textSecondary }]} numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}

export function ChatHeader({
  status,
  gps,
  manualLocation,
  onIdentifyPress,
  onSettingsPress,
  busy,
}: Props) {
  return (
    <View style={styles.header}>
      <LocationPill status={status} gps={gps} manualLocation={manualLocation} />
      <TouchableOpacity
        style={styles.identifyBtn}
        onPress={onIdentifyPress}
        disabled={busy}
        accessibilityLabel={t('chat.identifyThis')}
        accessibilityRole="button"
        testID="identify-this-btn"
      >
        <Text style={styles.identifyGlyph}>📷</Text>
        <Text style={styles.identifyLabel} numberOfLines={1}>
          {t('chat.identifyThis')}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.settingsBtn}
        onPress={onSettingsPress}
        accessibilityLabel={t('narration.settingsButton')}
        accessibilityRole="button"
      >
        <Text style={styles.settingsGlyph}>⚙</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  locationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: 6,
    ...Shadows.softOutset,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  settingsBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.softOutset,
  },
  settingsGlyph: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  identifyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radii.md,
    backgroundColor: Colors.primary,
    borderWidth: 1,
    borderColor: Colors.primary,
    ...Shadows.chipActiveHard,
  },
  identifyGlyph: {
    fontSize: 12,
  },
  identifyLabel: {
    ...Type.chip,
    color: '#FFFFFF',
  },
});
