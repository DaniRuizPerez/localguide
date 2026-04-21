/**
 * B5 — dwell detection hook. Verifies prolonged-presence trigger,
 * radius departure clearing, cooldown, and LLM POI skipping.
 */

import { renderHook, act } from '@testing-library/react-native';
import {
  useDwellDetection,
  DWELL_DURATION_MS,
  DWELL_RADIUS_METERS,
  POI_COOLDOWN_MS,
} from '../hooks/useDwellDetection';
import type { Poi } from '../services/PoiService';

const BASE_LAT = 48.8566;
const BASE_LON = 2.3522;

// A degree of latitude ~ 111 km. 0.001° ~ 111 m. Build helpers.
function gpsAt(mNorth: number): { latitude: number; longitude: number; accuracy: number } {
  return {
    latitude: BASE_LAT + mNorth / 111_000,
    longitude: BASE_LON,
    accuracy: 5,
  };
}

const poi: Poi = {
  pageId: 42,
  title: 'Place des Vosges',
  latitude: BASE_LAT,
  longitude: BASE_LON,
  distanceMeters: 0,
  source: 'wikipedia',
};

const llmPoi: Poi = {
  pageId: -1,
  title: 'AI suggestion',
  latitude: BASE_LAT,
  longitude: BASE_LON,
  distanceMeters: 0,
  source: 'llm',
};

describe('useDwellDetection', () => {
  it('does not fire until the user has stayed in range for DWELL_DURATION_MS', () => {
    let time = 1_000_000;
    const onDwell = jest.fn();
    const { result, rerender } = renderHook(
      (props: Parameters<typeof useDwellDetection>[0]) => useDwellDetection(props),
      {
        initialProps: {
          gps: gpsAt(0),
          pois: [poi],
          onDwell,
          now: () => time,
        },
      }
    );

    expect(result.current).toBeNull();
    expect(onDwell).not.toHaveBeenCalled();

    // Advance 1 min — still under the 2 min threshold
    act(() => {
      time += 60_000;
      rerender({ gps: gpsAt(0), pois: [poi], onDwell, now: () => time });
    });
    expect(result.current).toBeNull();

    // Advance past threshold
    act(() => {
      time += DWELL_DURATION_MS;
      rerender({ gps: gpsAt(0), pois: [poi], onDwell, now: () => time });
    });
    expect(onDwell).toHaveBeenCalledWith(poi);
    expect(result.current?.poi.pageId).toBe(poi.pageId);
  });

  it('does not fire when the user is outside DWELL_RADIUS_METERS', () => {
    let time = 1_000_000;
    const onDwell = jest.fn();
    renderHook(() =>
      useDwellDetection({
        gps: gpsAt(DWELL_RADIUS_METERS + 50),
        pois: [poi],
        onDwell,
        now: () => time,
      })
    );
    expect(onDwell).not.toHaveBeenCalled();
  });

  it('clears the triggered candidate when the user walks out of range', () => {
    let time = 1_000_000;
    const { result, rerender } = renderHook(
      (props: Parameters<typeof useDwellDetection>[0]) => useDwellDetection(props),
      {
        initialProps: { gps: gpsAt(0), pois: [poi], now: () => time },
      }
    );

    // Dwell to the trigger
    act(() => {
      time += DWELL_DURATION_MS + 1_000;
      rerender({ gps: gpsAt(0), pois: [poi], now: () => time });
    });
    expect(result.current).not.toBeNull();

    // Walk 500 m away
    act(() => {
      time += 1_000;
      rerender({ gps: gpsAt(500), pois: [poi], now: () => time });
    });
    expect(result.current).toBeNull();
  });

  it('honours the POI_COOLDOWN_MS after first fire', () => {
    let time = 1_000_000;
    const onDwell = jest.fn();
    const { rerender } = renderHook(
      (props: Parameters<typeof useDwellDetection>[0]) => useDwellDetection(props),
      {
        initialProps: { gps: gpsAt(0), pois: [poi], onDwell, now: () => time },
      }
    );

    // First fire
    act(() => {
      time += DWELL_DURATION_MS + 1;
      rerender({ gps: gpsAt(0), pois: [poi], onDwell, now: () => time });
    });
    expect(onDwell).toHaveBeenCalledTimes(1);

    // Walk away briefly
    act(() => {
      time += 1_000;
      rerender({ gps: gpsAt(500), pois: [poi], onDwell, now: () => time });
    });

    // Come back quickly — still under cooldown
    act(() => {
      time += 1_000;
      rerender({ gps: gpsAt(0), pois: [poi], onDwell, now: () => time });
    });
    act(() => {
      time += DWELL_DURATION_MS + 1;
      rerender({ gps: gpsAt(0), pois: [poi], onDwell, now: () => time });
    });
    expect(onDwell).toHaveBeenCalledTimes(1); // cooldown blocks

    // Wait out the cooldown
    act(() => {
      time += POI_COOLDOWN_MS;
      rerender({ gps: gpsAt(500), pois: [poi], onDwell, now: () => time });
    });
    act(() => {
      time += 1_000;
      rerender({ gps: gpsAt(0), pois: [poi], onDwell, now: () => time });
    });
    act(() => {
      time += DWELL_DURATION_MS + 1;
      rerender({ gps: gpsAt(0), pois: [poi], onDwell, now: () => time });
    });
    expect(onDwell).toHaveBeenCalledTimes(2);
  });

  it('ignores LLM-sourced POIs', () => {
    let time = 1_000_000;
    const onDwell = jest.fn();
    const { rerender } = renderHook(
      (props: Parameters<typeof useDwellDetection>[0]) => useDwellDetection(props),
      {
        initialProps: { gps: gpsAt(0), pois: [llmPoi], onDwell, now: () => time },
      }
    );
    act(() => {
      time += DWELL_DURATION_MS + 1;
      rerender({ gps: gpsAt(0), pois: [llmPoi], onDwell, now: () => time });
    });
    expect(onDwell).not.toHaveBeenCalled();
  });

  it('is inert when enabled=false', () => {
    let time = 1_000_000;
    const onDwell = jest.fn();
    renderHook(() =>
      useDwellDetection({
        gps: gpsAt(0),
        pois: [poi],
        onDwell,
        now: () => time,
        enabled: false,
      })
    );
    time += DWELL_DURATION_MS + 1;
    expect(onDwell).not.toHaveBeenCalled();
  });
});
