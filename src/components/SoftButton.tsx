import React, { useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Colors } from '../theme/colors';
import { Radii, Shadows, Type, Motion } from '../theme/tokens';

type Variant = 'primary' | 'secondary' | 'danger';

interface Props {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  variant?: Variant;
  size?: 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
  icon?: React.ReactNode;
}

export function SoftButton({
  label,
  onPress,
  disabled,
  variant = 'primary',
  size = 'lg',
  style,
  icon,
}: Props) {
  const translateY = useRef(new Animated.Value(0)).current;

  const handlePressIn = () => {
    Animated.timing(translateY, {
      toValue: Motion.pressTranslateY,
      duration: 80,
      useNativeDriver: true,
    }).start();
  };
  const handlePressOut = () => {
    Animated.spring(translateY, {
      toValue: 0,
      tension: 200,
      friction: 12,
      useNativeDriver: true,
    }).start();
  };

  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';
  const bg = isDanger ? Colors.error : isPrimary ? Colors.primary : Colors.surface;
  const color = isPrimary || isDanger ? '#FFFFFF' : Colors.text;
  const hardShadowColor = isDanger ? '#7F2424' : Colors.primaryDark;

  // Halo (outer) — soft glow. Hard (inner) — 3D offset.
  const halo = size === 'lg' ? Shadows.ctaHalo : Shadows.chipActiveHalo;
  const hardOffset = size === 'lg' ? 6 : 3;

  return (
    <View style={[styles.haloWrap, !disabled && isPrimary && halo, style]}>
      <Animated.View
        style={{
          transform: [{ translateY }],
        }}
      >
        <Pressable
          onPress={onPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          disabled={disabled}
          style={[
            styles.base,
            size === 'lg' ? styles.lg : styles.md,
            { backgroundColor: disabled ? Colors.disabled : bg },
            !disabled &&
              isPrimary && {
                shadowColor: hardShadowColor,
                shadowOffset: { width: 0, height: hardOffset },
                shadowOpacity: 1,
                shadowRadius: 0,
                elevation: 4,
              },
            !isPrimary && styles.secondaryBorder,
          ]}
          android_ripple={{ color: 'rgba(0,0,0,0.06)', borderless: false }}
        >
          {icon}
          <Text
            style={[
              Type.button,
              { color: disabled ? Colors.disabledText : color, textAlign: 'center' },
              icon ? { marginLeft: 8 } : null,
            ]}
          >
            {label}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  haloWrap: {
    borderRadius: Radii.xl,
  },
  base: {
    borderRadius: Radii.xl,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  lg: {
    paddingVertical: 15,
    paddingHorizontal: 24,
  },
  md: {
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  secondaryBorder: {
    borderWidth: 1,
    borderColor: Colors.border,
  },
});
