import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors } from '../theme/colors';

interface Props {
  size?: number;
}

// Circular peach-gradient avatar for the on-device guide. The "gradient" is
// approximated with a darker base + a lighter inset highlight ring (RN has no
// true radial gradient without an extra lib — this reads as peach 3D at a
// glance and keeps the bundle lean).
export function GuideAvatar({ size = 32 }: Props) {
  const r = size / 2;
  return (
    <View
      style={[
        styles.base,
        { width: size, height: size, borderRadius: r, backgroundColor: Colors.primary },
      ]}
    >
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 1,
          left: 1,
          right: 1,
          height: size * 0.45,
          borderTopLeftRadius: r,
          borderTopRightRadius: r,
          backgroundColor: 'rgba(255,229,212,0.55)',
        }}
      />
      <Text style={[styles.glyph, { fontSize: size * 0.52 }]}>◇</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 2,
  },
  glyph: {
    color: '#FFFFFF',
    fontWeight: '700',
    marginTop: -1,
  },
});
