/**
 * A7 — Around-you online dedup
 *
 * Verifies that skipLlmFill=true suppresses the LLM fallback entirely even
 * when the geo list is shorter than TARGET_COUNT, and that the LLM IS called
 * when skipLlmFill is absent/false (existing behavior is preserved).
 */

import { renderHook, waitFor } from '@testing-library/react-native';
import { useNearbyPois } from '../hooks/useNearbyPois';
import type { Poi } from '../services/PoiService';
import type { GPSContext } from '../services/InferenceService';

// ── Mock LiteRT so InferenceService stays in mock mode ─────────────────────
jest.mock('../native/LiteRTModule', () => ({ __esModule: true, default: undefined }));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///data/user/0/test/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: false }),
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
}));

// ── Mocks for the two services the hook calls ───────────────────────────────
const mockFetchNearbyStreaming = jest.fn();
const mockListNearbyPlaces = jest.fn();
const mockVerifyNearbyPlaces = jest.fn();

jest.mock('../services/PoiService', () => {
  const actual = jest.requireActual('../services/PoiService');
  return {
    ...actual,
    poiService: {
      fetchNearbyStreaming: (...args: unknown[]) => mockFetchNearbyStreaming(...args),
      fetchNearby: jest.fn().mockResolvedValue([]),
      clearCache: jest.fn(),
    },
  };
});

jest.mock('../services/LocalGuideService', () => {
  const actual = jest.requireActual('../services/LocalGuideService');
  return {
    ...actual,
    localGuideService: {
      ...actual.localGuideService,
      listNearbyPlaces: (...args: unknown[]) => mockListNearbyPlaces(...args),
      verifyNearbyPlaces: (...args: unknown[]) => mockVerifyNearbyPlaces(...args),
      prefetchQuiz: jest.fn(),
    },
  };
});

// ── Fixtures ─────────────────────────────────────────────────────────────────
const GPS: GPSContext = {
  latitude: 37.4275,
  longitude: -122.1697,
  placeName: 'Stanford, CA',
};

function makePoi(n: number): Poi {
  return {
    pageId: n,
    title: `Real POI ${n}`,
    latitude: 37.4275,
    longitude: -122.1697,
    distanceMeters: n * 100,
    source: 'wikipedia',
  };
}

// fetchNearbyStreaming calls onPartial then resolves with the full list.
function streamingResult(pois: Poi[]) {
  return jest.fn().mockImplementation(
    (_lat, _lon, _r, _limit, _opts, callbacks: { onPartial?: (p: Poi[], s: string) => void }) => {
      callbacks?.onPartial?.(pois, 'wikipedia');
      return Promise.resolve(pois);
    }
  );
}

// A task-like object returned by listNearbyPlaces / verifyNearbyPlaces.
function makeTask(names: string[]) {
  return { promise: Promise.resolve(names), abort: jest.fn().mockResolvedValue(undefined) };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('useNearbyPois — skipLlmFill', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyNearbyPlaces.mockReturnValue(makeTask([]));
  });

  it('does NOT call listNearbyPlaces when skipLlmFill=true and geo < TARGET_COUNT', async () => {
    // 3 real POIs — well below TARGET_COUNT (6)
    const geoPois = [makePoi(1), makePoi(2), makePoi(3)];
    mockFetchNearbyStreaming.mockImplementation(streamingResult(geoPois));

    const { result } = renderHook(() =>
      useNearbyPois(GPS, 5000, { offline: false, skipLlmFill: true })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Real POIs shown
    expect(result.current.pois).toHaveLength(3);
    // LLM fallback never invoked
    expect(mockListNearbyPlaces).not.toHaveBeenCalled();
    expect(mockVerifyNearbyPlaces).not.toHaveBeenCalled();
  });

  it('calls listNearbyPlaces when skipLlmFill=false (default) and geo < TARGET_COUNT', async () => {
    const geoPois = [makePoi(1), makePoi(2)];
    mockFetchNearbyStreaming.mockImplementation(streamingResult(geoPois));
    mockListNearbyPlaces.mockReturnValue(makeTask(['AI Spot A', 'AI Spot B', 'AI Spot C', 'AI Spot D']));
    mockVerifyNearbyPlaces.mockReturnValue(makeTask(['AI Spot A', 'AI Spot B', 'AI Spot C', 'AI Spot D']));

    const { result } = renderHook(() =>
      useNearbyPois(GPS, 5000, { offline: false, skipLlmFill: false })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // LLM fallback fired
    expect(mockListNearbyPlaces).toHaveBeenCalledTimes(1);
    // Both real + LLM POIs merged
    expect(result.current.pois.length).toBeGreaterThan(2);
  });

  it('does NOT call listNearbyPlaces when geo count reaches TARGET_COUNT regardless of skipLlmFill', async () => {
    // Exactly 6 real POIs — no fill needed
    const geoPois = [1, 2, 3, 4, 5, 6].map(makePoi);
    mockFetchNearbyStreaming.mockImplementation(streamingResult(geoPois));

    const { result } = renderHook(() =>
      useNearbyPois(GPS, 5000, { offline: false, skipLlmFill: false })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.pois).toHaveLength(6);
    expect(mockListNearbyPlaces).not.toHaveBeenCalled();
  });

  it('offline=true still calls listNearbyPlaces (LLM fill unchanged)', async () => {
    const geoPois = [makePoi(1)];
    mockFetchNearbyStreaming.mockImplementation(streamingResult(geoPois));
    mockListNearbyPlaces.mockReturnValue(makeTask(['Offline Spot 1', 'Offline Spot 2']));
    mockVerifyNearbyPlaces.mockReturnValue(makeTask(['Offline Spot 1', 'Offline Spot 2']));

    const { result } = renderHook(() =>
      useNearbyPois(GPS, 5000, { offline: true, skipLlmFill: false })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockListNearbyPlaces).toHaveBeenCalledTimes(1);
  });
});
