import { Animated, StyleSheet } from 'react-native';
import { useEffect, useRef } from 'react';
import { useAppMode } from '../hooks/useAppMode';
import { Colors } from '../theme/colors';

/**
 * Persistent visual signal of offline mode. Decorative — not interactive,
 * not announced by screen readers (which already get the OfflineNotice
 * banner's accessibilityRole="alert"). Renders once at root in App.tsx;
 * absolute-positioned + pointerEvents="none" so it sits above all screens
 * without intercepting taps.
 */
export function ModeStripe() {
  const { effective } = useAppMode();
  const opacity = useRef(new Animated.Value(effective === 'offline' ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: effective === 'offline' ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [effective, opacity]);

  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      style={[styles.stripe, { opacity }]}
    />
  );
}

const styles = StyleSheet.create({
  stripe: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 8,
    // Colors.warning (#E8A84E light / #F0B85E dark) — confirmed present in
    // src/theme/colors.ts in both LIGHT_PALETTE and DARK_PALETTE.
    backgroundColor: Colors.warning,
    zIndex: 1000,
  },
});
