import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../theme/colors';
import { Radii, Shadows, Type } from '../theme/tokens';
import { Wordmark } from './Wordmark';
import { t } from '../i18n';
import type { GPSContext } from '../services/InferenceService';

interface Props {
  status: string;
  gps: GPSContext | null;
  manualLocation: string | null;
  onSettingsPress: () => void;
  /** When provided, renders a back arrow on the left (shown in chat mode). */
  onBack?: () => void;
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
    name = gps.placeName ?? t('chat.hereGeneric');
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
      <Text
        style={[Type.metaUpper, { color: Colors.textSecondary, flexShrink: 1 }]}
        numberOfLines={1}
      >
        {name}
      </Text>
    </View>
  );
}

/**
 * Chat-screen header: wordmark (or a back arrow in active chat) on the left,
 * location pill + settings gear on the right. Replaces what used to be the
 * React Navigation header row (wordmark only) plus a second row rendered
 * inside the screen (location + settings) — merging them saves ~40 px of
 * vertical space so Home CTAs sit higher on the viewport.
 *
 * The Chat tab turns off the nav header (see AppNavigator), so this
 * component is responsible for its own top safe-area inset.
 */
export function ChatHeader({ status, gps, manualLocation, onSettingsPress, onBack }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: 6 + insets.top }]}>
      <View style={styles.left}>
        {onBack ? (
          <TouchableOpacity
            style={styles.backBtn}
            onPress={onBack}
            accessibilityLabel={t('nav.back')}
            accessibilityRole="button"
            testID="chat-back-btn"
          >
            <Text style={styles.backGlyph}>‹</Text>
          </TouchableOpacity>
        ) : (
          <Wordmark />
        )}
      </View>
      <View style={styles.right}>
        <LocationPill status={status} gps={gps} manualLocation={manualLocation} />
        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={onSettingsPress}
          accessibilityLabel={t('settings.title')}
          accessibilityRole="button"
          testID="settings-btn"
        >
          <Text style={styles.settingsGlyph}>⚙</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 14,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: Colors.background,
  },
  left: {
    flexShrink: 0,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
    minWidth: 0,
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
    flexShrink: 1,
    maxWidth: 170,
    ...Shadows.softOutset,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
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
    flexShrink: 0,
    ...Shadows.softOutset,
  },
  settingsGlyph: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  backBtn: {
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
  backGlyph: {
    fontSize: 22,
    lineHeight: 24,
    color: Colors.textSecondary,
    marginTop: -2,
  },
});
