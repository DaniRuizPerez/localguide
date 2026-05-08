/**
 * RouteService.walkingTimeMatrix tests.
 *
 * Covers: happy path, URL shape + User-Agent, partial null cells,
 * null on non-OK / fetch error / timeout, coord cap, and in-memory cache.
 *
 * AsyncStorage is mocked globally via jest.setup.js (the async-storage-mock
 * package). fetch is mocked per-test via global.fetch.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { routeService } from '../services/RouteService';

// ─── Mock global.fetch ──────────────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const C1 = { lat: 37.4419, lon: -122.1430 }; // Palo Alto
const C2 = { lat: 37.4275, lon: -122.1697 }; // Stanford
const C3 = { lat: 37.4485, lon: -122.1590 }; // Menlo Park

const COORDS_3 = [C1, C2, C3];

/** Well-formed OSRM table response for 3 coords. */
function osrmOk(
  durations: (number | null)[][],
  distances: (number | null)[][]
) {
  return {
    ok: true,
    json: async () => ({ code: 'Ok', durations, distances }),
  };
}

const DURATIONS_3 = [
  [0, 180, 240],
  [180, 0, 120],
  [240, 120, 0],
];

const DISTANCES_3 = [
  [0, 200, 300],
  [200, 0, 150],
  [300, 150, 0],
];

// ─── Reset between tests ─────────────────────────────────────────────────────

beforeEach(async () => {
  mockFetch.mockReset();
  routeService._clearMemoryCache();
  await AsyncStorage.clear();
});

// ─── 1. Happy path ────────────────────────────────────────────────────────────

describe('walkingTimeMatrix — happy path', () => {
  it('returns minutes and meters matrices for a 3-coord input', async () => {
    mockFetch.mockResolvedValue(osrmOk(DURATIONS_3, DISTANCES_3));

    const result = await routeService.walkingTimeMatrix(COORDS_3);

    expect(result).not.toBeNull();
    // 180 s / 60 = 3 min
    expect(result!.minutes[0][1]).toBe(3);
    // 240 s / 60 = 4 min
    expect(result!.minutes[0][2]).toBe(4);
    // 120 s / 60 = 2 min
    expect(result!.minutes[1][2]).toBe(2);
    // metres pass through rounded
    expect(result!.meters[0][1]).toBe(200);
    expect(result!.meters[1][2]).toBe(150);
  });

  it('enforces Math.max(1, ...) so very short legs are at least 1 min', async () => {
    // 30 s → rounds to 1 (not 0)
    const durations = [[0, 30, 60], [30, 0, 45], [60, 45, 0]];
    const distances = [[0, 50, 100], [50, 0, 75], [100, 75, 0]];
    mockFetch.mockResolvedValue(osrmOk(durations, distances));

    const result = await routeService.walkingTimeMatrix(COORDS_3);
    expect(result).not.toBeNull();
    // 30 s → Math.round(30/60) = 1, Math.max(1,1) = 1
    expect(result!.minutes[0][1]).toBe(1);
  });
});

// ─── 2. URL shape ─────────────────────────────────────────────────────────────

describe('walkingTimeMatrix — URL shape', () => {
  it('constructs the OSRM /table/v1/foot/ URL with lon,lat ordering', async () => {
    mockFetch.mockResolvedValue(osrmOk(DURATIONS_3, DISTANCES_3));

    await routeService.walkingTimeMatrix(COORDS_3);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toContain('/table/v1/foot/');
    expect(url).toContain('?annotations=duration,distance');
    // OSRM uses lon,lat — verify first coord appears as lon,lat
    const expectedFirst = `${C1.lon},${C1.lat}`;
    expect(url).toContain(expectedFirst);
  });
});

// ─── 3. User-Agent header ────────────────────────────────────────────────────

describe('walkingTimeMatrix — User-Agent header', () => {
  it('sends the expected User-Agent header', async () => {
    mockFetch.mockResolvedValue(osrmOk(DURATIONS_3, DISTANCES_3));

    await routeService.walkingTimeMatrix(COORDS_3);

    const opts = mockFetch.mock.calls[0][1];
    expect(opts?.headers?.['User-Agent']).toBe(
      'LocalGuide/1.0 (https://github.com/DaniRuizPerez/localguide)'
    );
  });
});

// ─── 4. Partial null cells ───────────────────────────────────────────────────

describe('walkingTimeMatrix — partial null cells', () => {
  it('substitutes haversine for null duration/distance cells', async () => {
    // Make one cell null — simulating OSRM returning null for unreachable pair.
    const durationsWithNull: (number | null)[][] = [
      [0, null, 240],
      [null, 0, 120],
      [240, 120, 0],
    ];
    const distancesWithNull: (number | null)[][] = [
      [0, null, 300],
      [null, 0, 150],
      [300, 150, 0],
    ];
    mockFetch.mockResolvedValue(osrmOk(durationsWithNull, distancesWithNull));

    const result = await routeService.walkingTimeMatrix(COORDS_3);

    expect(result).not.toBeNull();
    // The null cell should be filled in with haversine (positive, not NaN or 0).
    expect(result!.minutes[0][1]).toBeGreaterThan(0);
    expect(Number.isNaN(result!.minutes[0][1])).toBe(false);
    expect(result!.meters[0][1]).toBeGreaterThan(0);
  });
});

// ─── 5. null on failures ─────────────────────────────────────────────────────

describe('walkingTimeMatrix — failure returns null', () => {
  it('returns null when HTTP response is not OK', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    expect(await routeService.walkingTimeMatrix(COORDS_3)).toBeNull();
  });

  it('returns null when fetch rejects with a network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    expect(await routeService.walkingTimeMatrix(COORDS_3)).toBeNull();
  });

  it('returns null when fetch rejects with an AbortError (timeout)', async () => {
    mockFetch.mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    expect(await routeService.walkingTimeMatrix(COORDS_3)).toBeNull();
  });

  it('returns null when OSRM response code is not Ok', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ code: 'InvalidUrl', durations: [], distances: [] }),
    });
    expect(await routeService.walkingTimeMatrix(COORDS_3)).toBeNull();
  });
});

// ─── 6. Coord cap ────────────────────────────────────────────────────────────

describe('walkingTimeMatrix — coord cap', () => {
  it('returns null immediately for >16 coords without calling fetch', async () => {
    const tooMany = Array.from({ length: 17 }, (_, i) => ({
      lat: 37.4 + i * 0.01,
      lon: -122.1,
    }));
    const result = await routeService.walkingTimeMatrix(tooMany);
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does NOT cap at exactly 12 coords', async () => {
    const exactly12 = Array.from({ length: 12 }, (_, i) => ({
      lat: 37.4 + i * 0.01,
      lon: -122.1,
    }));
    // Provide a minimal valid OSRM response.
    const n = 12;
    const dur = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (__, j) => (i === j ? 0 : 120))
    );
    const dist = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (__, j) => (i === j ? 0 : 200))
    );
    mockFetch.mockResolvedValue(osrmOk(dur, dist));
    const result = await routeService.walkingTimeMatrix(exactly12);
    expect(result).not.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ─── 7. Cache ─────────────────────────────────────────────────────────────────

describe('walkingTimeMatrix — in-memory LRU cache', () => {
  it('serves the second call from in-memory cache (fetch called only once)', async () => {
    mockFetch.mockResolvedValue(osrmOk(DURATIONS_3, DISTANCES_3));

    const first = await routeService.walkingTimeMatrix(COORDS_3);
    const second = await routeService.walkingTimeMatrix(COORDS_3);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  it('does not serve cache for a different coord list', async () => {
    mockFetch.mockResolvedValue(osrmOk(DURATIONS_3, DISTANCES_3));

    await routeService.walkingTimeMatrix(COORDS_3);

    const different = [C1, C3]; // different set
    const dur2 = [[0, 60], [60, 0]];
    const dist2 = [[0, 100], [100, 0]];
    mockFetch.mockResolvedValue(osrmOk(dur2, dist2));
    await routeService.walkingTimeMatrix(different);

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ─── 8. AsyncStorage cache ────────────────────────────────────────────────────

describe('walkingTimeMatrix — AsyncStorage cache', () => {
  it('reads from AsyncStorage on cold start (in-memory cleared)', async () => {
    // First call: prime with OSRM.
    mockFetch.mockResolvedValue(osrmOk(DURATIONS_3, DISTANCES_3));
    await routeService.walkingTimeMatrix(COORDS_3);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Evict in-memory cache to simulate cold start.
    routeService._clearMemoryCache();

    // Second call: should read from AsyncStorage, not fetch.
    const result = await routeService.walkingTimeMatrix(COORDS_3);
    expect(mockFetch).toHaveBeenCalledTimes(1); // no extra fetch
    expect(result).not.toBeNull();
  });
});
