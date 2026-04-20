import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Slider from '@react-native-community/slider';
import { Colors } from '../theme/colors';
import { Type } from '../theme/tokens';

const MIN_RADIUS_METERS = 200;
const MAX_RADIUS_METERS = 20000;
// Coarser step above 1 km feels better on the slider — 100 m granularity at
// 20 km is imperceptible but costs extra renders. We keep the step at 100 m
// overall for simplicity; the slider thumb still snaps smoothly.
const STEP_METERS = 100;

function formatRadius(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters % 1000 === 0 ? 0 : 1)} km`;
}

export function RadiusSelector({
  value,
  onChange,
  style,
}: {
  value: number;
  onChange: (meters: number) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const [displayValue, setDisplayValue] = useState(value);
  useEffect(() => {
    setDisplayValue(value);
  }, [value]);

  return (
    <View style={[styles.row, style]}>
      <Text style={[Type.metaUpper, { color: Colors.textTertiary }]}>RADIUS</Text>
      <Slider
        style={styles.slider}
        minimumValue={MIN_RADIUS_METERS}
        maximumValue={MAX_RADIUS_METERS}
        step={STEP_METERS}
        value={displayValue}
        onValueChange={setDisplayValue}
        onSlidingComplete={(v) => onChange(Math.round(v))}
        minimumTrackTintColor={Colors.primary}
        maximumTrackTintColor={Colors.border}
        thumbTintColor={Colors.primary}
      />
      <Text style={styles.valueLabel}>{formatRadius(displayValue)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 4,
    gap: 10,
    backgroundColor: Colors.background,
  },
  slider: {
    flex: 1,
    height: 32,
  },
  valueLabel: {
    fontSize: 11,
    color: Colors.text,
    fontWeight: '700',
    minWidth: 52,
    textAlign: 'right',
    letterSpacing: 0.2,
  },
});
