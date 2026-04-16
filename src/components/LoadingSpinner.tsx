import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';

interface Props {
  label?: string;
}

export function LoadingSpinner({ label }: Props) {
  return (
    <View style={styles.row}>
      <ActivityIndicator size="small" color="#007AFF" />
      {label != null && <Text style={styles.label}>{label}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 6 },
  label: { marginLeft: 6, fontSize: 13, color: '#8E8E93' },
});
