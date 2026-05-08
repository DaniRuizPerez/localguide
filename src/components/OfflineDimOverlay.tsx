import { Animated, StyleSheet } from 'react-native';
import { useEffect, useRef } from 'react';
import { useAppMode } from '../hooks/useAppMode';

/**
 * Subtle warm-brown overlay rendered across the whole app when offline mode
 * is active. Tints the cream UI toward a dimmer, more "dark-mode-ish" vibe
 * without requiring every StyleSheet.create() in the codebase to be migrated
 * to a hook (the v1.1 refactor that would let `Colors` flip live).
 *
 * Why a tint and not a real dark palette swap:
 *   - `Colors` is captured at module load (see src/theme/colors.ts:126).
 *     A live system-theme flip already needs an app restart; we can't
 *     piggyback offline on that without the same restart cost.
 *   - A single `<Animated.View>` overlay with `pointerEvents="none"` reads
 *     visually as "color scheme shifted" (cream → dim-cafe) and costs zero
 *     plumbing changes.
 *
 * Z-order: 998 — above the navigator so the tint covers the whole app
 * surface. Modals rendered later in the tree sit above this tint, which
 * is fine — modal backdrops already darken on their own.
 *
 * Color: `rgba(40, 25, 8, 0.18)` — warm brown at 18% alpha. Picked so the
 * cream `#F5EBDF` background reads as a dim warm tan; dark text keeps
 * roughly 5:1 contrast (above WCAG AA 4.5:1).
 */
export function OfflineDimOverlay() {
  const { effective } = useAppMode();
  const opacity = useRef(new Animated.Value(effective === 'offline' ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: effective === 'offline' ? 1 : 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [effective, opacity]);

  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      style={[styles.overlay, { opacity }]}
    />
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(40, 25, 8, 0.18)',
    zIndex: 998,
  },
});
