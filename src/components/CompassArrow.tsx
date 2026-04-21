import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View, Easing } from 'react-native';
import { Colors } from '../theme/colors';
import { Radii, Shadows, Type } from '../theme/tokens';
import { useHeading } from '../hooks/useHeading';
import { t } from '../i18n';

interface Props {
  /** Target latitude/longitude. */
  targetLat: number;
  targetLon: number;
  /** User's current location. */
  userLat: number;
  userLon: number;
  /** POI name for the label. */
  label: string;
  /** When false the compass is inert (saves battery). */
  enabled?: boolean;
}

// Bearing in degrees from user to target (0 = north, 90 = east).
export function bearingDegrees(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function CompassArrow({
  targetLat,
  targetLon,
  userLat,
  userLon,
  label,
  enabled = true,
}: Props) {
  const heading = useHeading(enabled);
  const bearing = bearingDegrees(userLat, userLon, targetLat, targetLon);
  // What we rotate the arrow by: target bearing MINUS device heading gives
  // the angle relative to where the phone is pointing.
  const relativeAngle = heading == null ? 0 : bearing - heading;

  const rotation = useRef(new Animated.Value(relativeAngle)).current;
  useEffect(() => {
    // Animate the arrow smoothly — compass readings are noisy at the
    // ~200ms update rate so raw values look jittery.
    Animated.timing(rotation, {
      toValue: relativeAngle,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [relativeAngle, rotation]);

  const rotateStyle = {
    transform: [
      {
        rotate: rotation.interpolate({
          inputRange: [-360, 360],
          outputRange: ['-360deg', '360deg'],
        }),
      },
    ],
  };

  const distance = haversineMeters(userLat, userLon, targetLat, targetLon);

  return (
    <View style={styles.container} accessibilityLabel={t('compass.accessibilityLabel', { label })}>
      <View style={styles.dial}>
        <Animated.Text style={[styles.arrow, rotateStyle]}>↑</Animated.Text>
        {heading == null && <Text style={styles.noCompass}>⌀</Text>}
      </View>
      <View style={styles.meta}>
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
        <Text style={styles.distance}>{formatDistance(distance)}</Text>
        {heading == null && (
          <Text style={styles.hint}>{t('compass.noSensor')}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radii.lg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.softOutset,
  },
  dial: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: {
    fontSize: 26,
    color: Colors.primary,
    fontWeight: '700',
    lineHeight: 28,
  },
  noCompass: {
    position: 'absolute',
    fontSize: 14,
    color: Colors.textTertiary,
    opacity: 0.6,
  },
  meta: {
    flex: 1,
    gap: 2,
  },
  label: {
    ...Type.poi,
    color: Colors.text,
  },
  distance: {
    ...Type.metaUpper,
    color: Colors.textSecondary,
  },
  hint: {
    ...Type.metaUpper,
    color: Colors.error,
  },
});
