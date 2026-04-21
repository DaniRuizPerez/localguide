import { useEffect, useState } from 'react';
import { Magnetometer, type MagnetometerMeasurement } from 'expo-sensors';

// Device heading in degrees (0 = north, 90 = east). Null while permission
// resolves or on devices without a magnetometer.
//
// Uses the raw magnetometer x/y to derive bearing — accurate to within ~5–15°
// once the user has done the figure-8 calibration motion. Good enough for a
// "head that way" arrow; not for turn-by-turn nav.

export function useHeading(enabled: boolean): number | null {
  const [heading, setHeading] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setHeading(null);
      return;
    }

    let cancelled = false;
    let subscription: { remove: () => void } | null = null;

    (async () => {
      try {
        const available = await Magnetometer.isAvailableAsync();
        if (!available || cancelled) return;
      } catch {
        return;
      }
      if (cancelled) return;
      Magnetometer.setUpdateInterval(200);
      subscription = Magnetometer.addListener((m: MagnetometerMeasurement) => {
        setHeading(compassHeadingFromMagnetometer(m));
      });
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [enabled]);

  return heading;
}

/**
 * Convert a raw magnetometer reading (µT, device frame) to a compass heading
 * in degrees (0–360, 0 = magnetic north, 90 = east).
 *
 * expo-sensors returns x/y/z in the device's own coordinate frame. For a
 * phone held flat, x points right and y points up. atan2(y, x) yields the
 * angle from east measured CCW; convert to a compass heading:
 *   heading = 90 - atan2(y, x) in degrees, normalised to [0, 360).
 */
export function compassHeadingFromMagnetometer({ x, y }: { x: number; y: number }): number {
  const angle = Math.atan2(y, x) * (180 / Math.PI);
  // Convert from "angle from +X axis CCW" to "compass heading CW from north".
  const heading = 90 - angle;
  return ((heading % 360) + 360) % 360;
}
