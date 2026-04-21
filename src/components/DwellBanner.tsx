import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '../theme/colors';
import { Radii, Shadows, Spacing, Type } from '../theme/tokens';
import { t } from '../i18n';
import type { Poi } from '../services/PoiService';

interface Props {
  poi: Poi;
  onAccept: () => void;
  onDismiss: () => void;
}

// Gentle "want to hear about this?" banner surfaced when the user has
// dwelled at a POI for a couple of minutes (see useDwellDetection).
export function DwellBanner({ poi, onAccept, onDismiss }: Props) {
  return (
    <View style={styles.container}>
      <View style={{ flex: 1 }}>
        <Text style={styles.eyebrow}>{t('dwell.eyebrow')}</Text>
        <Text style={styles.title} numberOfLines={1}>
          {t('dwell.prompt', { label: poi.title })}
        </Text>
      </View>
      <TouchableOpacity onPress={onAccept} style={styles.accept} accessibilityLabel={t('dwell.accept')}>
        <Text style={styles.acceptLabel}>{t('dwell.accept')}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onDismiss} style={styles.dismiss} accessibilityLabel={t('dwell.dismiss')}>
        <Text style={styles.dismissLabel}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 14,
    marginTop: 6,
    marginBottom: 2,
    padding: 10,
    backgroundColor: Colors.secondaryLight,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: 'rgba(78,163,116,0.25)',
    ...Shadows.softOutset,
  },
  eyebrow: {
    ...Type.metaUpper,
    color: Colors.secondary,
  },
  title: {
    ...Type.bodySm,
    color: Colors.text,
    marginTop: 2,
  },
  accept: {
    backgroundColor: Colors.secondary,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radii.md,
    ...Shadows.chipActiveHard,
  },
  acceptLabel: {
    ...Type.chip,
    color: '#FFFFFF',
  },
  dismiss: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginLeft: Spacing.xs,
  },
  dismissLabel: {
    color: Colors.textSecondary,
    fontWeight: '700',
  },
});
