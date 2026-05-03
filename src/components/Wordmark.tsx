import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { Colors } from '../theme/colors';
import { Type } from '../theme/tokens';

interface Props {
  style?: StyleProp<ViewStyle>;
  size?: number;
}

export function Wordmark({ style, size = 18 }: Props) {
  return (
    <View style={[styles.row, style]}>
      <Svg width={size * 0.9} height={size * 0.9} viewBox="0 0 32 32" style={{ marginRight: 8 }}>
        <Circle cx="16" cy="16" r="14" fill="none" stroke={Colors.primary} strokeWidth="1" opacity="0.35" />
        <Circle cx="16" cy="16" r="10" fill="none" stroke={Colors.primary} strokeWidth="1" opacity="0.55" />
        <Circle cx="16" cy="16" r="6"  fill="none" stroke={Colors.primary} strokeWidth="1" opacity="0.8" />
        <Circle cx="16" cy="16" r="2.5" fill={Colors.primary} />
        <Line x1="16" y1="2"  x2="16" y2="6"  stroke={Colors.primary} strokeWidth="1.5" />
        <Line x1="16" y1="26" x2="16" y2="30" stroke={Colors.primary} strokeWidth="1.5" />
      </Svg>
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
