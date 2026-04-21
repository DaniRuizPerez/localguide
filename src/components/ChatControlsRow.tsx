import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { Colors } from '../theme/colors';
import { t } from '../i18n';

interface Props {
  autoGuide: boolean;
  onAutoGuideChange: (next: boolean) => void;
  speak: boolean;
  onSpeakChange: (next: boolean) => void;
  hiddenGems: boolean;
  onHiddenGemsChange: (next: boolean) => void;
}

export function ChatControlsRow({
  autoGuide,
  onAutoGuideChange,
  speak,
  onSpeakChange,
  hiddenGems,
  onHiddenGemsChange,
}: Props) {
  return (
    <View style={styles.controlsRow}>
      <Toggle
        label={t('chat.autoGuide')}
        value={autoGuide}
        onChange={onAutoGuideChange}
        tint={Colors.secondary}
      />
      <Toggle label={t('chat.speak')} value={speak} onChange={onSpeakChange} tint={Colors.primary} />
      <Toggle
        label={t('chat.hiddenGems')}
        value={hiddenGems}
        onChange={onHiddenGemsChange}
        tint={Colors.secondary}
      />
    </View>
  );
}

function Toggle({
  label,
  value,
  onChange,
  tint,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
  tint: string;
}) {
  return (
    <View style={styles.controlItem}>
      <Text style={styles.controlLabel} numberOfLines={1}>
        {label}
      </Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: Colors.border, true: tint }}
        thumbColor={Colors.surface}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: Colors.background,
    gap: 14,
    flexWrap: 'wrap',
  },
  controlItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  controlLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 10,
    letterSpacing: 0.8,
    color: Colors.textSecondary,
    flexShrink: 0,
  },
});
