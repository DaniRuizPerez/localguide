import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppMode } from '../hooks/useAppMode';
import { Colors } from '../theme/colors';
import { Type } from '../theme/tokens';
import { t } from '../i18n';

// Persistent amber strip rendered directly under ChatHeader / MapHeader while
// the app is in offline mode. Disappears automatically when effective is
// 'online'. Not dismissible — the warning is load-bearing for trust because
// every offline output is AI-generated and may be wrong.
export function OfflineNotice() {
  const { effective } = useAppMode();
  if (effective !== 'offline') return null;

  return (
    <View style={styles.strip} accessibilityRole="alert">
      <Text style={styles.text}>{t('offlineNotice.banner')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    backgroundColor: Colors.warningLight,
    borderBottomWidth: 1,
    borderBottomColor: Colors.warning,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 28,
    justifyContent: 'center',
  },
  text: {
    ...Type.bodySm,
    color: '#8A4B00',
  },
});
