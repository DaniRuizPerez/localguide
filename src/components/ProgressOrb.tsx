import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Colors } from '../theme/colors';
import { Type } from '../theme/tokens';

interface Props {
  percent: number; // 0..100
  label?: string; // e.g. "338 of 528 MB"
  state?: 'downloading' | 'paused' | 'complete' | 'error' | 'idle';
  size?: number;
}

// Soft peach orb with a rotating progress ring approximated by an animated
// dashed border — RN has no SVG arc without a dep, so we fake the ring with a
// rotating overlay whose `borderTopColor` is peach and the rest transparent.
// That's enough to read as "progress" without bringing in react-native-svg.
export function ProgressOrb({ percent, label, state = 'downloading', size = 180 }: Props) {
  const innerSize = size * 0.78;
  const pct = Math.max(0, Math.min(100, percent));

  // Ring angle tracks actual progress — tween smoothly to pct/100 whenever
  // it advances so the user sees the arc "close in" as bytes arrive instead
  // of a free-spinning loop that's disconnected from the percent readout.
  const rotate = useRef(new Animated.Value(pct / 100)).current;
  useEffect(() => {
    Animated.timing(rotate, {
      toValue: pct / 100,
      duration: 400,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [pct, rotate]);

  const rotation = rotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={[styles.orb, { width: size, height: size, borderRadius: size / 2 }]}>
      {/* Soft outer glow ring */}
      <View
        style={[
          styles.softRing,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
          },
        ]}
      />
      {/* Rotating progress arc — one quarter filled, rotates while active */}
      <Animated.View
        style={[
          styles.arc,
          {
            width: size - 4,
            height: size - 4,
            borderRadius: (size - 4) / 2,
            transform: [{ rotate: rotation }],
          },
        ]}
      />
      {/* Inner surface circle */}
      <View
        style={[
          styles.inner,
          {
            width: innerSize,
            height: innerSize,
            borderRadius: innerSize / 2,
          },
        ]}
      >
        {state === 'error' ? (
          <Text style={[Type.display, { color: Colors.error }]}>!</Text>
        ) : state === 'complete' ? (
          <Text style={[Type.display, { color: Colors.primary }]}>✓</Text>
        ) : (
          <Text style={[Type.display, { color: Colors.primary }]}>{pct}%</Text>
        )}
        {label ? (
          <Text
            style={[
              Type.metaUpper,
              { color: Colors.textTertiary, marginTop: 2 },
            ]}
          >
            {label}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  orb: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primaryLight,
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 8,
  },
  softRing: {
    position: 'absolute',
    borderWidth: 10,
    borderColor: 'rgba(232,132,92,0.15)',
  },
  arc: {
    position: 'absolute',
    borderWidth: 4,
    borderColor: 'transparent',
    borderTopColor: Colors.primary,
    borderRightColor: Colors.primary,
  },
  inner: {
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: -2, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
});
