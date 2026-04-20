import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Colors } from '../theme/colors';
import { Type } from '../theme/tokens';

interface Props {
  style?: StyleProp<ViewStyle>;
  size?: number;
}

export function Wordmark({ style, size = 18 }: Props) {
  return (
    <View style={[styles.row, style]}>
      <View
        style={{
          width: size * 0.9,
          height: size * 0.9,
          borderRadius: (size * 0.9) / 2,
          backgroundColor: Colors.primary,
          marginRight: 8,
          shadowColor: Colors.primaryDark,
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.35,
          shadowRadius: 3,
          elevation: 2,
        }}
      />
      <Text style={[Type.title, { color: Colors.text, fontSize: size + 2 }]}>Local Guide</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
