/**
 * Tests for useWalkingDistances — overlays OSRM walking metres/minutes onto
 * a ranked POI list. Mocks routeService so the test doesn't hit the network.
 */

import { renderHook, waitFor } from '@testing-library/react-native';
import { useWalkingDistances } from '../hooks/useWalkingDistances';
import { routeService } from '../services/RouteService';
import type { Poi } from '../services/PoiService';
import type { GPSContext } from '../services/InferenceService';

jest.mock('../services/RouteService', () => ({
  routeService: { walkingTimeMatrix: jest.fn() },
}));
const mockMatrix = routeService.walkingTimeMatrix as jest.MockedFunction<
  typeof routeService.walkingTimeMatrix
>;

const gps: GPSContext = {
  latitude: 37.4232,
  longitude: -122.1494,
  accuracy: 10,
};

function poi(pageId: number, title: string, lat: number, lon: number, dist: number): Poi {
  return { pageId, title, latitude: lat, longitude: lon, distanceMeters: dist, source: 'wikipedia' };
}

describe('useWalkingDistances', () => {
  beforeEach(() => mockMatrix.mockReset());

  it('passes pois through unchanged when gps is null', () => {
    const pois = [poi(1, 'A', 37.4, -122.1, 1000)];
    const { result } = renderHook(() => useWalkingDistances(pois, null));
    expect(result.current.enriched).toBe(pois);
    expect(mockMatrix).not.toHaveBeenCalled();
  });

  it('passes pois through unchanged when list is empty', () => {
    const { result } = renderHook(() => useWalkingDistances([], gps));
    expect(result.current.enriched).toEqual([]);
    expect(mockMatrix).not.toHaveBeenCalled();
  });

  it('overlays walkingMeters + walkingMinutes from matrix row 0', async () => {
    const pois = [poi(1, 'A', 37.43, -122.16, 1500), poi(2, 'B', 37.42, -122.15, 800)];
    mockMatrix.mockResolvedValueOnce({
      // 3×3: user(0), A(1), B(2)
      meters: [
        [0, 1900, 1100],
        [1900, 0, 700],
        [1100, 700, 0],
      ],
      minutes: [
        [0, 23, 13],
        [23, 0, 9],
        [13, 9, 0],
      ],
    });

    const { result } = renderHook(() => useWalkingDistances(pois, gps));
    await waitFor(() => expect(result.current.enriched[0].walkingMeters).toBe(1900));
    expect(result.current.enriched[0].walkingMinutes).toBe(23);
    expect(result.current.enriched[1].walkingMeters).toBe(1100);
    expect(result.current.enriched[1].walkingMinutes).toBe(13);
    // Haversine distance preserved.
    expect(result.current.enriched[0].distanceMeters).toBe(1500);
  });

  it('falls back to original pois on matrix failure', async () => {
    const pois = [poi(1, 'A', 37.43, -122.16, 1500)];
    mockMatrix.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useWalkingDistances(pois, gps));
    await waitFor(() => expect(mockMatrix).toHaveBeenCalled());
    expect(result.current.enriched[0].walkingMeters).toBeUndefined();
    expect(result.current.enriched[0].distanceMeters).toBe(1500);
  });

  it('skips llm-source pois (placeholder coords would poison the matrix)', async () => {
    const pois: Poi[] = [
      poi(1, 'A', 37.43, -122.16, 1500),
      { pageId: -1, title: 'AI', latitude: gps.latitude, longitude: gps.longitude, distanceMeters: 0, source: 'llm' },
    ];
    mockMatrix.mockResolvedValueOnce({
      // 2×2: user(0), A(1) — only the real POI is in the call.
      meters: [
        [0, 1900],
        [1900, 0],
      ],
      minutes: [
        [0, 23],
        [23, 0],
      ],
    });
    const { result } = renderHook(() => useWalkingDistances(pois, gps));
    await waitFor(() => expect(result.current.enriched[0].walkingMeters).toBe(1900));
    // The llm POI is preserved at its original index (rank order kept).
    expect(result.current.enriched[1].source).toBe('llm');
    expect(result.current.enriched[1].walkingMeters).toBeUndefined();

    // Verify only the user + real POI coords were passed.
    const coords = mockMatrix.mock.calls[0][0];
    expect(coords).toHaveLength(2);
    expect(coords[0].lat).toBe(gps.latitude);
    expect(coords[1].lat).toBe(37.43);
  });
});
