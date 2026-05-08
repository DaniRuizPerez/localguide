import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors } from '../theme/colors';
import { Radii, Type } from '../theme/tokens';
import { t } from '../i18n';

export type Source = 'wikipedia' | 'maps' | 'geonames' | 'ai-online' | 'ai-offline';

interface Props {
  source: Source;
}

const GLYPH: Record<Source, string> = {
  wikipedia: '📖',
  maps: '🗺',
  geonames: '📍',
  'ai-online': '🧠',
  'ai-offline': '🧠',
};

// i18n key suffix per source variant.
const I18N_KEY: Record<Source, 'source.wikipedia' | 'source.maps' | 'source.geonames' | 'source.aiOnline' | 'source.aiOffline'> = {
  wikipedia:  'source.wikipedia',
  maps:       'source.maps',
  geonames:   'source.geonames',
  'ai-online':  'source.aiOnline',
  'ai-offline': 'source.aiOffline',
};

// Background / text colours per variant.
const BG: Record<Source, string> = {
  wikipedia:  Colors.surface,        // neutral cream
  maps:       '#D9EAF5',             // soft blue tint
  geonames:   Colors.surface,        // neutral cream — like Wikipedia, GeoNames is real-world data
  'ai-online':  Colors.primaryLight, // soft peach / primary tint
  'ai-offline': Colors.warningLight, // soft amber (#FBEBD0)
};

const FG: Record<Source, string> = {
  wikipedia:  Colors.textSecondary,
  maps:       '#1A4D6E',
  geonames:   Colors.textSecondary,
  'ai-online':  Colors.primaryDark,
  'ai-offline': '#8A4B00',
};

const BORDER: Record<Source, string> = {
  wikipedia:  Colors.borderLight,
  maps:       '#A9CCE0',
  geonames:   Colors.borderLight,
  'ai-online':  Colors.primaryDark,
  'ai-offline': Colors.warning,
};

export function SourceBadge({ source }: Props) {
  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: BG[source],
          borderColor: BORDER[source],
        },
      ]}
    >
      <Text style={[styles.label, { color: FG[source] }]}>
        {GLYPH[source]} {t(I18N_KEY[source])}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radii.sm,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  label: {
    ...Type.chip,
  },
});
