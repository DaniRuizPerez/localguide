/**
 * Tests for useRankedPois hook.
 *
 * Mirrors the mocking style of useNearbyPois.online.test.ts.
 * Covers:
 *  - Offline mode: returns rankByInterestOffline output, loading stays false.
 *  - Online mode, no signals yet: returns rankByInterestSync output, loading true.
 *  - Online mode, signals resolved: returns rankByInterestOnline output, loading false.
 *  - Unmount during async fetch: no setState warning.
 *  - Empty pois input: returns empty ranked array.
 */

import { renderHook, waitFor, act } from '@testing-library/react-native';
import { useRankedPois } from '../hooks/useRankedPois';
import type { Poi } from '../services/PoiService';
import type { GPSContext } from '../services/InferenceService';

// ── Mock LiteRT so InferenceService stays in mock mode ─────────────────────
jest.mock('../native/LiteRTModule', () => ({ __esModule: true, default: undefined }));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///data/user/0/test/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: false }),
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
}));

// ── Mock poiRanking ─────────────────────────────────────────────────────────
const mockRankByInterestSync = jest.fn();
const mockRankByInterestOffline = jest.fn();
const mockRankByInterestOnline = jest.fn();

jest.mock('../services/poiRanking', () => ({
  rankByInterestSync: (...args: unknown[]) => mockRankByInterestSync(...args),
  rankByInterestOffline: (...args: unknown[]) => mockRankByInterestOffline(...args),
  rankByInterestOnline: (...args: unknown[]) => mockRankByInterestOnline(...args),
  rankByInterest: (...args: unknown[]) => mockRankByInterestSync(...args),
}));

// ── Mock wikipediaSignals ───────────────────────────────────────────────────
const mockFetchBatch = jest.fn();

jest.mock('../services/wikipediaSignals', () => ({
  wikipediaSignals: {
    fetchBatch: (...args: unknown[]) => mockFetchBatch(...args),
    __resetForTest: jest.fn(),
  },
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────
const GPS: GPSContext = {
  latitude: 37.4275,
  longitude: -122.1697,
  placeName: 'Stanford, CA',
};

function makePoi(n: number, source: Poi['source'] = 'wikipedia'): Poi {
  return {
    pageId: n,
    title: `POI ${n}`,
    latitude: 37.4275,
    longitude: -122.1697,
    distanceMeters: n * 100,
    source,
  };
}

const DEFAULT_OPTS = {
  hiddenGems: false,
  offline: false,
  radiusMeters: 5000,
};

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('useRankedPois', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: sync/offline rankers return their input unchanged for easy assertion.
    mockRankByInterestSync.mockImplementation((pois: Poi[]) => [...pois]);
    mockRankByInterestOffline.mockImplementation((pois: Poi[]) => [...pois]);
    mockRankByInterestOnline.mockImplementation((pois: Poi[]) => [...pois]);
    // Default: fetchBatch never resolves (simulates in-flight).
    mockFetchBatch.mockReturnValue(new Promise(() => {}));
  });

  // ── Offline mode ───────────────────────────────────────────────────────────

  it('offline: calls rankByInterestOffline, loading stays false', () => {
    const pois = [makePoi(1), makePoi(2)];
    const offlinePois = [makePoi(2), makePoi(1)]; // reversed to verify it's offline result
    mockRankByInterestOffline.mockReturnValue(offlinePois);

    const { result } = renderHook(() =>
      useRankedPois(pois, GPS, { ...DEFAULT_OPTS, offline: true })
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.ranked).toEqual(offlinePois);
    expect(mockRankByInterestOffline).toHaveBeenCalledWith(
      pois,
      GPS,
      { hiddenGems: false, radiusMeters: 5000 }
    );
    expect(mockRankByInterestSync).not.toHaveBeenCalled();
    expect(mockFetchBatch).not.toHaveBeenCalled();
  });

  it('offline: never triggers async fetch even with wikipedia pois', async () => {
    const pois = [makePoi(1, 'wikipedia'), makePoi(2, 'wikipedia')];
    mockRankByInterestOffline.mockReturnValue(pois);

    const { result } = renderHook(() =>
      useRankedPois(pois, GPS, { ...DEFAULT_OPTS, offline: true })
    );

    // Wait a tick to confirm nothing async fired.
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(mockFetchBatch).not.toHaveBeenCalled();
  });

  // ── Online mode, signals in-flight ────────────────────────────────────────

  it('online: returns sync result with loading=true while fetch is in flight', () => {
    const pois = [makePoi(1), makePoi(2)];
    const syncResult = [makePoi(2), makePoi(1)];
    mockRankByInterestSync.mockReturnValue(syncResult);
    // fetchBatch never resolves.
    mockFetchBatch.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() =>
      useRankedPois(pois, GPS, DEFAULT_OPTS)
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.ranked).toEqual(syncResult);
    expect(mockRankByInterestSync).toHaveBeenCalled();
    expect(mockFetchBatch).toHaveBeenCalled();
  });

  // ── Online mode, signals resolved ─────────────────────────────────────────

  it('online: switches to rankByInterestOnline result with loading=false after signals resolve', async () => {
    const pois = [makePoi(1, 'wikipedia'), makePoi(2, 'wikipedia')];
    const syncResult = [makePoi(1), makePoi(2)];
    const onlineResult = [makePoi(2), makePoi(1)]; // different order
    const fakeSignals = new Map([[1, { categories: [], langlinkCount: 5, pageviews60d: 1000 }]]);

    mockRankByInterestSync.mockReturnValue(syncResult);
    mockRankByInterestOnline.mockReturnValue(onlineResult);
    mockFetchBatch.mockResolvedValue(fakeSignals);

    const { result } = renderHook(() =>
      useRankedPois(pois, GPS, DEFAULT_OPTS)
    );

    // Initially sync result with loading true.
    expect(result.current.ranked).toEqual(syncResult);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.ranked).toEqual(onlineResult);
    expect(mockRankByInterestOnline).toHaveBeenCalledWith(
      pois,
      GPS,
      fakeSignals,
      { hiddenGems: false, radiusMeters: 5000 }
    );
  });

  // ── Online mode, empty signals (size === 0) ───────────────────────────────

  it('online: keeps sync result if fetchBatch resolves with empty signals map', async () => {
    const pois = [makePoi(1, 'wikipedia')];
    const syncResult = [makePoi(1)];
    mockRankByInterestSync.mockReturnValue(syncResult);
    mockFetchBatch.mockResolvedValue(new Map());

    const { result } = renderHook(() =>
      useRankedPois(pois, GPS, DEFAULT_OPTS)
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Online ranker must NOT have been called — sync result is kept.
    expect(mockRankByInterestOnline).not.toHaveBeenCalled();
    expect(result.current.ranked).toEqual(syncResult);
  });

  // ── Unmount during async fetch ────────────────────────────────────────────

  it('unmount during async fetch: no setState-after-unmount warning', async () => {
    const pois = [makePoi(1, 'wikipedia')];
    let resolveSignals!: (v: Map<number, unknown>) => void;
    mockFetchBatch.mockReturnValue(
      new Promise<Map<number, unknown>>((res) => { resolveSignals = res; })
    );
    mockRankByInterestSync.mockReturnValue(pois);

    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = renderHook(() =>
      useRankedPois(pois, GPS, DEFAULT_OPTS)
    );

    // Unmount before signals resolve.
    unmount();

    // Now resolve — should not trigger a setState on unmounted component.
    await act(async () => {
      resolveSignals(new Map([[1, { categories: [], langlinkCount: 0, pageviews60d: 100 }]]));
      await Promise.resolve();
    });

    // React warns with "Can't perform a React state update on an unmounted
    // component" — ensure it never fired.
    const setStateWarnings = consoleError.mock.calls.filter((args) =>
      String(args[0]).includes('unmounted')
    );
    expect(setStateWarnings).toHaveLength(0);

    consoleError.mockRestore();
  });

  // ── Empty pois ────────────────────────────────────────────────────────────

  it('empty pois: returns empty ranked array, loading false, no fetch', async () => {
    mockRankByInterestSync.mockReturnValue([]);

    const { result } = renderHook(() =>
      useRankedPois([], GPS, DEFAULT_OPTS)
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.ranked).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(mockFetchBatch).not.toHaveBeenCalled();
  });

  // ── No wikipedia source pois ──────────────────────────────────────────────

  it('online: no wikipedia pois skips fetchBatch, loading stays false', async () => {
    const pois = [makePoi(1, 'llm'), makePoi(2, 'geonames')];
    mockRankByInterestSync.mockReturnValue(pois);

    const { result } = renderHook(() =>
      useRankedPois(pois, GPS, DEFAULT_OPTS)
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(mockFetchBatch).not.toHaveBeenCalled();
    expect(result.current.ranked).toEqual(pois);
  });

  // ── hiddenGems option is forwarded ────────────────────────────────────────

  it('forwards hiddenGems option to rankers', () => {
    const pois = [makePoi(1)];
    mockRankByInterestSync.mockReturnValue(pois);

    renderHook(() =>
      useRankedPois(pois, GPS, { ...DEFAULT_OPTS, hiddenGems: true })
    );

    expect(mockRankByInterestSync).toHaveBeenCalledWith(
      pois,
      GPS,
      expect.objectContaining({ hiddenGems: true })
    );
  });

  // ── null GPS ──────────────────────────────────────────────────────────────

  it('handles null GPS gracefully', () => {
    const pois = [makePoi(1)];
    mockRankByInterestSync.mockReturnValue(pois);

    const { result } = renderHook(() =>
      useRankedPois(pois, null, DEFAULT_OPTS)
    );

    expect(result.current.ranked).toEqual(pois);
    expect(result.current.loading).toBe(true); // fetch still fires for wiki pois
  });
});
