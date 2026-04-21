import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, type StyleProp, type ViewStyle } from 'react-native';
import { PillowChip } from './PillowChip';
import { Colors } from '../theme/colors';
import { t } from '../i18n';
import {
  narrationPrefs,
  NARRATION_LENGTH_VALUES,
  type NarrationLength,
} from '../services/NarrationPrefs';

// Horizontal picker between Short / Standard / Deep dive. Subscribes to the
// shared narrationPrefs store so any change anywhere updates this UI too.
export function NarrationLengthPicker({ style }: { style?: StyleProp<ViewStyle> }) {
  const [length, setLength] = useState<NarrationLength>(narrationPrefs.get().length);

  useEffect(() => {
    return narrationPrefs.subscribe((p) => setLength(p.length));
  }, []);

  const labelFor = (value: NarrationLength): string => {
    switch (value) {
      case 'short':
        return t('narration.lengthShort');
      case 'standard':
        return t('narration.lengthStandard');
      case 'deep':
        return t('narration.lengthDeepDive');
    }
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.scroll, style]}
      contentContainerStyle={styles.row}
    >
      {NARRATION_LENGTH_VALUES.map((value) => (
        <PillowChip
          key={value}
          label={labelFor(value)}
          active={value === length}
          onPress={() => narrationPrefs.setLength(value)}
        />
      ))}
      <View style={{ width: 4 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 0,
    backgroundColor: Colors.background,
  },
  row: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
});
