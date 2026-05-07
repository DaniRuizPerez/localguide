/**
 * Tests for the pure snap-point math used by the MapScreen pullup sheet.
 * No native deps, no rendering — just the JS logic that decides where the
 * sheet lands when the user releases a drag.
 */

import { nearestSnap, SNAP_FULL, SNAP_HALF, SNAP_COLLAPSED } from '../screens/MapScreen';

describe('MapScreen pullup snap math', () => {
  describe('snap points are ordered Full < Half < Collapsed', () => {
    it('orders correctly', () => {
      expect(SNAP_FULL).toBeLessThan(SNAP_HALF);
      expect(SNAP_HALF).toBeLessThan(SNAP_COLLAPSED);
      expect(SNAP_FULL).toBe(0);
    });
  });

  describe('zero / low velocity → nearest by distance', () => {
    it('a release just below Full snaps to Full', () => {
      expect(nearestSnap(SNAP_FULL + 20, 0)).toBe(SNAP_FULL);
    });

    it('a release just above Half snaps to Half', () => {
      expect(nearestSnap(SNAP_HALF - 30, 0)).toBe(SNAP_HALF);
    });

    it('a release just below Collapsed snaps to Collapsed', () => {
      expect(nearestSnap(SNAP_COLLAPSED - 30, 0)).toBe(SNAP_COLLAPSED);
    });

    it('a release midway Half↔Collapsed snaps to whichever is closer', () => {
      const midway = (SNAP_HALF + SNAP_COLLAPSED) / 2;
      // Tiny bias toward Collapsed
      expect(nearestSnap(midway + 5, 0)).toBe(SNAP_COLLAPSED);
      // Tiny bias toward Half
      expect(nearestSnap(midway - 5, 0)).toBe(SNAP_HALF);
    });
  });

  describe('velocity-aware fling overrides distance', () => {
    it('fast upward fling (vy < -0.5) snaps to Full from any position', () => {
      expect(nearestSnap(SNAP_COLLAPSED, -1.5)).toBe(SNAP_FULL);
      expect(nearestSnap(SNAP_HALF, -0.6)).toBe(SNAP_FULL);
    });

    it('fast downward fling (vy > 0.5) snaps to Collapsed from any position', () => {
      expect(nearestSnap(SNAP_FULL, 1.5)).toBe(SNAP_COLLAPSED);
      expect(nearestSnap(SNAP_HALF, 0.6)).toBe(SNAP_COLLAPSED);
    });

    it('slow drag (|vy| ≤ 0.5) does NOT trigger fling — falls back to nearest', () => {
      // From near-Full with slow upward velocity → still snaps to Full
      // (because nearest), but for the OPPOSITE direction:
      // From near-Full with slow downward → still snaps to Full because
      // distance dominates.
      expect(nearestSnap(SNAP_FULL + 10, 0.4)).toBe(SNAP_FULL);
      expect(nearestSnap(SNAP_COLLAPSED - 10, -0.4)).toBe(SNAP_COLLAPSED);
    });
  });
});
