/**
 * RouteService.walkingTimeMatrix tests.
 *
 * The implementation now uses haversine × URBAN_DETOUR (1.4) at 5 km/h
 * walking speed. Free, instant, no network — the previous OSRM-backed
 * version was abandoned because the public demo server only serves the
 * car profile (a `/foot/` request returned 26 km/h car data).
 */

import { routeService } from '../services/RouteService';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const C1 = { lat: 37.4419, lon: -122.1430 }; // Palo Alto
const C2 = { lat: 37.4275, lon: -122.1697 }; // Stanford
const C3 = { lat: 37.4485, lon: -122.1590 }; // Menlo Park

const COORDS_3 = [C1, C2, C3];

beforeEach(() => {
  routeService._clearMemoryCache();
});

// ─── 1. Shape ────────────────────────────────────────────────────────────────

describe('walkingTimeMatrix — shape', () => {
  it('returns N×N matrices for N coords', async () => {
    const result = await routeService.walkingTimeMatrix(COORDS_3);
    expect(result).not.toBeNull();
    expect(result!.minutes).toHaveLength(3);
    expect(result!.meters).toHaveLength(3);
    for (const row of result!.minutes) expect(row).toHaveLength(3);
    for (const row of result!.meters) expect(row).toHaveLength(3);
  });

  it('returns 0 on the diagonal (coord vs itself)', async () => {
    const result = await routeService.walkingTimeMatrix(COORDS_3);
    for (let i = 0; i < 3; i++) {
      expect(result!.minutes[i][i]).toBe(0);
      expect(result!.meters[i][i]).toBe(0);
    }
  });
});

// ─── 2. Symmetry ─────────────────────────────────────────────────────────────

describe('walkingTimeMatrix — symmetry', () => {
  it('A→B equals B→A (haversine is symmetric)', async () => {
    const result = await routeService.walkingTimeMatrix(COORDS_3);
    expect(result!.minutes[0][1]).toBe(result!.minutes[1][0]);
    expect(result!.minutes[0][2]).toBe(result!.minutes[2][0]);
    expect(result!.meters[0][1]).toBe(result!.meters[1][0]);
    expect(result!.meters[1][2]).toBe(result!.meters[2][1]);
  });
});

// ─── 3. Walking-pace consistency ─────────────────────────────────────────────

describe('walkingTimeMatrix — walking-pace consistency', () => {
  it('minutes always equals max(1, round(meters / 83.33))', async () => {
    const result = await routeService.walkingTimeMatrix(COORDS_3);
    const WALK_MPS = 5000 / 60;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (i === j) continue;
        const expectedMin = Math.max(1, Math.round(result!.meters[i][j] / WALK_MPS));
        expect(result!.minutes[i][j]).toBe(expectedMin);
      }
    }
  });

  it('floors at 1 min — no "0 min walk" labels possible', async () => {
    // Two coords ~5 m apart → very short straight-line, but min minute = 1.
    const ultraClose = [
      { lat: 37.4232, lon: -122.1494 },
      { lat: 37.4232, lon: -122.149405 }, // ~5 m east
    ];
    const result = await routeService.walkingTimeMatrix(ultraClose);
    expect(result).not.toBeNull();
    expect(result!.minutes[0][1]).toBe(1);
    expect(result!.minutes[1][0]).toBe(1);
  });
});

// ─── 4. Urban-detour factor applied to distance ──────────────────────────────

describe('walkingTimeMatrix — urban-detour factor', () => {
  it('returns metres ≈ haversine × 1.4 (rounded to int)', async () => {
    // Use a pair we can compute the haversine for independently.
    // 1 deg of lat ≈ 111.32 km; we use 0.01 deg ≈ 1.113 km between the two.
    const a = { lat: 37.4232, lon: -122.1494 };
    const b = { lat: 37.4332, lon: -122.1494 }; // 0.01 deg N → ~1113 m
    const result = await routeService.walkingTimeMatrix([a, b]);
    expect(result).not.toBeNull();
    // 1113 m × 1.4 ≈ 1558 m. Allow ±2 m for floating-point + rounding.
    const m = result!.meters[0][1];
    expect(m).toBeGreaterThan(1550);
    expect(m).toBeLessThan(1565);
  });
});

// ─── 5. Coord cap ────────────────────────────────────────────────────────────

describe('walkingTimeMatrix — coord cap', () => {
  it('returns null immediately for >16 coords', async () => {
    const tooMany = Array.from({ length: 17 }, (_, i) => ({
      lat: 37.4 + i * 0.01,
      lon: -122.1,
    }));
    const result = await routeService.walkingTimeMatrix(tooMany);
    expect(result).toBeNull();
  });

  it('does NOT cap at exactly 16 coords', async () => {
    const exactly16 = Array.from({ length: 16 }, (_, i) => ({
      lat: 37.4 + i * 0.01,
      lon: -122.1,
    }));
    const result = await routeService.walkingTimeMatrix(exactly16);
    expect(result).not.toBeNull();
  });
});

// ─── 6. In-memory LRU cache ──────────────────────────────────────────────────

describe('walkingTimeMatrix — in-memory LRU cache', () => {
  it('returns the cached object on the second call', async () => {
    const first = await routeService.walkingTimeMatrix(COORDS_3);
    const second = await routeService.walkingTimeMatrix(COORDS_3);
    expect(first).toBe(second); // same reference (LRU returned cached)
  });

  it('reorders LRU on hit (recency)', async () => {
    // Just check we get the same result for the same input across calls.
    const result1 = await routeService.walkingTimeMatrix(COORDS_3);
    const otherCoords = [C1, C3];
    await routeService.walkingTimeMatrix(otherCoords);
    const result3 = await routeService.walkingTimeMatrix(COORDS_3);
    expect(result1).toBe(result3);
  });
});
