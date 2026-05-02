/**
 * ModeChangeToast — transient slide-up toast that fires on online↔offline
 * transitions.
 *
 * Design notes:
 * - Amber background / dark-amber text to match OfflineNotice palette.
 * - Native-driver fade + translateY so the JS thread is never blocked.
 * - Auto-dismisses after 4 s; swipe-down dismisses early via PanResponder.
 * - The parent remounts this component on each new transition (key={toast.id})
 *   so the timer and animation always start fresh — no stale-closure risk.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, Text } from 'react-native';
import { Colors } from '../theme/colors';
import { Radii, Type } from '../theme/tokens';

const AUTO_DISMISS_MS = 4000;
/** translateY the toast starts from (off-screen below, slides up). */
const SLIDE_IN_FROM = 40;
/** If the user swipes down more than this many px, dismiss early. */
const SWIPE_DISMISS_THRESHOLD = 20;

interface Props {
  text: string;
  onDismiss: () => void;
}

export function ModeChangeToast({ text, onDismiss }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(SLIDE_IN_FROM)).current;
  const dismissed = useRef(false);

  function dismiss() {
    if (dismissed.current) return;
    dismissed.current = true;
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: SLIDE_IN_FROM, duration: 200, useNativeDriver: true }),
    ]).start(() => onDismiss());
  }

  useEffect(() => {
    // Slide + fade in.
    const entryAnim = Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]);
    entryAnim.start();

    const timer = setTimeout(dismiss, AUTO_DISMISS_MS);

    return () => {
      clearTimeout(timer);
      entryAnim.stop();
    };
    // `dismiss` and animated values are stable refs; intentionally omitting
    // from deps so the cleanup only fires on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 5,
      onPanResponderMove: (_, gestureState) => {
        // Allow only downward drag (positive dy).
        if (gestureState.dy > 0) {
          translateY.setValue(gestureState.dy);
          opacity.setValue(Math.max(0, 1 - gestureState.dy / 60));
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy >= SWIPE_DISMISS_THRESHOLD) {
          dismiss();
        } else {
          // Snap back.
          Animated.parallel([
            Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
            Animated.timing(translateY, { toValue: 0, duration: 150, useNativeDriver: true }),
          ]).start();
        }
      },
    })
  ).current;

  return (
    <Animated.View
      testID="mode-change-toast"
      style={[styles.toast, { opacity, transform: [{ translateY }] }]}
      {...panResponder.panHandlers}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Text style={styles.text}>{text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    bottom: 80,
    left: 16,
    right: 16,
    backgroundColor: Colors.warningLight,
    borderWidth: 1,
    borderColor: Colors.warning,
    borderRadius: Radii.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    // Elevate above message list and input bar.
    zIndex: 100,
    elevation: 8,
    shadowColor: '#B8623A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
  },
  text: {
    ...Type.bodySm,
    color: '#8A4B00',
  },
});
