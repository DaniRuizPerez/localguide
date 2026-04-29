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

// Soft peach orb whose ring grows as a closing arc with progress.
//
// RN has no SVG arc primitive (and the repo deliberately avoids
// react-native-svg), so we use a "rotating half-disc mask" trick:
//
//   1. A full peach ring is drawn underneath (always visible).
//   2. Two half-disc masks (same colour as the orb's background) sit on top
//      of the ring, each clipped to one half of the orb via `overflow:
//      hidden`. At rest the half-discs cover the entire ring.
//   3. Each half-disc rotates around the orb's centre. As it rotates 0deg
//      -> 180deg the covered area sweeps out, progressively exposing the
//      peach ring beneath.
//
// The right mask handles 0..50% (rotates 0 -> 180deg). Then the left mask
// handles 50..100%. The visible arc length therefore matches `percent`
// rather than free-spinning.
const RING_WIDTH = 4;

export function ProgressOrb({ percent, label, state = 'downloading', size = 180 }: Props) {
  const innerSize = size * 0.78;
  const ringSize = size - 4;
  const halfSize = ringSize / 2;
  const pct = Math.max(0, Math.min(100, percent));

  // Animate progress 0..1 smoothly when `percent` changes so the arc
  // visibly closes in instead of snapping.
  const progress = useRef(new Animated.Value(pct / 100)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: pct / 100,
      duration: 400,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [pct, progress]);

  // Right mask: 0deg (covers right half) -> 180deg (uncovered) over 0..50%.
  const rightMaskRotate = progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['0deg', '180deg', '180deg'],
  });
  // Left mask: stays at 0deg (covers left half) until 50%, then 0 -> 180deg.
  const leftMaskRotate = progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['0deg', '0deg', '180deg'],
  });

  return (
    <View style={[styles.orb, { width: size, height: size, borderRadius: size / 2 }]}>
      {/* Subtle ambient ring behind everything */}
      <View
        style={[
          styles.softRing,
          { width: size, height: size, borderRadius: size / 2 },
        ]}
      />

      {/* Single ring container so the full ring, both masks and the tick all
          share a coordinate system centred in the orb. */}
      <View
        style={[
          styles.ringContainer,
          { width: ringSize, height: ringSize, borderRadius: ringSize / 2 },
        ]}
      >
        {/* Full peach progress ring — always rendered. The masks above cover
            whatever portion shouldn't be visible yet. */}
        <View
          style={[
            styles.fullRing,
            { width: ringSize, height: ringSize, borderRadius: ringSize / 2 },
          ]}
        />

        {/* RIGHT HALF — clipped wrapper covering the right semicircle.
            Inside is a "pivot" of size ringSize whose centre coincides with
            the wrapper's LEFT edge (= orb centreline). The half-disc child
            sits on the pivot's right side; rotating the pivot sweeps the
            half-disc around the orb's centre. */}
        <View
          style={[
            styles.halfWrap,
            { right: 0, top: 0, width: halfSize, height: ringSize },
          ]}
        >
          <Animated.View
            style={[
              styles.pivot,
              {
                width: ringSize,
                height: ringSize,
                left: -halfSize,
                top: 0,
                transform: [{ rotate: rightMaskRotate }],
              },
            ]}
          >
            <View
              style={[
                styles.halfDisc,
                {
                  width: halfSize,
                  height: ringSize,
                  left: halfSize,
                  borderTopRightRadius: halfSize,
                  borderBottomRightRadius: halfSize,
                },
              ]}
            />
          </Animated.View>
        </View>

        {/* LEFT HALF — mirror. Pivot centre sits on the wrapper's RIGHT
            edge (= orb centreline); half-disc on the pivot's left side. */}
        <View
          style={[
            styles.halfWrap,
            { left: 0, top: 0, width: halfSize, height: ringSize },
          ]}
        >
          <Animated.View
            style={[
              styles.pivot,
              {
                width: ringSize,
                height: ringSize,
                left: 0,
                top: 0,
                transform: [{ rotate: leftMaskRotate }],
              },
            ]}
          >
            <View
              style={[
                styles.halfDisc,
                {
                  width: halfSize,
                  height: ringSize,
                  left: 0,
                  borderTopLeftRadius: halfSize,
                  borderBottomLeftRadius: halfSize,
                },
              ]}
            />
          </Animated.View>
        </View>

        {/* Tick at 12 o'clock so 0% still shows a reference cue */}
        <View
          style={[
            styles.tick,
            { left: halfSize - 2, top: 0 },
          ]}
        />
      </View>

      {/* Inner surface circle with the readout */}
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
  ringContainer: {
    position: 'absolute',
  },
  fullRing: {
    position: 'absolute',
    borderWidth: RING_WIDTH,
    borderColor: Colors.primary,
  },
  halfWrap: {
    position: 'absolute',
    overflow: 'hidden',
  },
  pivot: {
    position: 'absolute',
  },
  // Half-disc filled with the orb's background colour, used to mask the
  // ring underneath. Shape (D vs reverse-D) and placement are set inline.
  halfDisc: {
    position: 'absolute',
    backgroundColor: Colors.primaryLight,
  },
  tick: {
    position: 'absolute',
    width: 4,
    height: RING_WIDTH,
    backgroundColor: Colors.primary,
    borderRadius: 2,
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
