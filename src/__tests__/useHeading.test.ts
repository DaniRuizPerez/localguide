/**
 * B1 — useHeading + compass math.
 */

import { compassHeadingFromMagnetometer } from '../hooks/useHeading';

describe('compassHeadingFromMagnetometer', () => {
  // The math normalises atan2(y, x) into a compass heading (0 = N, 90 = E).
  // Using signed magnetometer-like vectors.
  it('x>0, y=0 (phone pointed east) → heading 90', () => {
    expect(compassHeadingFromMagnetometer({ x: 20, y: 0 })).toBeCloseTo(90, 1);
  });

  it('x=0, y>0 (phone pointed north) → heading 0', () => {
    expect(compassHeadingFromMagnetometer({ x: 0, y: 20 })).toBeCloseTo(0, 1);
  });

  it('x<0, y=0 (phone pointed west) → heading 270', () => {
    expect(compassHeadingFromMagnetometer({ x: -20, y: 0 })).toBeCloseTo(270, 1);
  });

  it('x=0, y<0 (phone pointed south) → heading 180', () => {
    expect(compassHeadingFromMagnetometer({ x: 0, y: -20 })).toBeCloseTo(180, 1);
  });

  it('returns a value in [0, 360)', () => {
    for (const { x, y } of [
      { x: 3, y: -5 },
      { x: -7, y: -2 },
      { x: 12, y: 8 },
    ]) {
      const h = compassHeadingFromMagnetometer({ x, y });
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });
});
