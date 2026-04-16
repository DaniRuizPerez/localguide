import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  role: 'user' | 'guide';
  text: string;
  durationMs?: number;
}

export function MessageBubble({ role, text, durationMs }: Props) {
  const isUser = role === 'user';
  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowGuide]}>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleGuide]}>
        <Text style={[styles.text, isUser ? styles.textUser : styles.textGuide]}>{text}</Text>
        {durationMs != null && (
          <Text style={styles.meta}>{durationMs}ms · on-device</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginVertical: 4, flexDirection: 'row' },
  rowUser: { justifyContent: 'flex-end' },
  rowGuide: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '80%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  bubbleUser: { backgroundColor: '#007AFF', borderBottomRightRadius: 4 },
  bubbleGuide: { backgroundColor: '#FFFFFF', borderBottomLeftRadius: 4 },
  text: { fontSize: 15, lineHeight: 20 },
  textUser: { color: '#FFFFFF' },
  textGuide: { color: '#1C1C1E' },
  meta: { fontSize: 10, color: '#8E8E93', marginTop: 3 },
});
