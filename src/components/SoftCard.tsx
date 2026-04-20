import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Colors } from '../theme/colors';
import { Radii, Shadows } from '../theme/tokens';

interface Props {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  variant?: 'outset' | 'floating' | 'inset';
}

export function SoftCard({ style, children, variant = 'outset' }: Props) {
  const shadow =
    variant === 'floating' ? Shadows.softFloating : variant === 'inset' ? null : Shadows.softOutset;
  return (
    <View style={[styles.base, shadow, style]}>
      {/* Inner subtle highlight rim on the top — gives the soft pillow feel. */}
      <View pointerEvents="none" style={styles.highlight} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: Colors.surface,
    borderRadius: Radii.xl,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    overflow: 'visible',
  },
  highlight: {
    position: 'absolute',
    top: 1,
    left: 1,
    right: 1,
    height: 1,
    borderRadius: Radii.xl,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
});
