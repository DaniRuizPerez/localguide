/**
 * Tests for useProximityNarration — fires an onNarrate callback when the user
 * walks within PROXIMITY_THRESHOLD_METERS of a Wikipedia POI, with a 30 s
 * cooldown between firings, and skips LLM-sourced POIs (their coordinates are
 * placeholders copied from the user's own position).
 *
 * @testing-library/react-native in this project has no renderHook, so we mount
 * a throwaway component that calls the hook — JSX kept out on purpose so the
 * file stays .ts (using React.createElement).
 */

import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import type { GPSContext } from '../services/InferenceService';
import type { Poi } from '../services/PoiService';
import { useProximityNarration } from '../hooks/useProximityNarration';

type HookArgs = {
  gps: GPSContext | null;
  pois: Poi[];
  onNarrate: (poi: Poi) => void;
  enabled: boolean;
};

function Harness(props: HookArgs): React.ReactElement {
  useProximityNarration(props);
  return React.createElement(Text, null, 'harness');
}

function el(props: HookArgs): React.ReactElement {
  return React.createElement(Harness, props);
}

const STANFORD: GPSContext = { latitude: 37.4275, longitude: -122.1697 };
const HOOVER_TOWER: Poi = {
  pageId: 100,
  title: 'Hoover Tower',
  latitude: 37.4275, // same as user — within 120 m
  longitude: -122.1697,
  distanceMeters: 0,
  source: 'wikipedia',
};
const FAR_POI: Poi = {
  pageId: 200,
  title: 'Far Away Park',
  latitude: 37.5,
  longitude: -122.3, // ~15 km away
  distanceMeters: 15000,
  source: 'wikipedia',
};
const LLM_POI: Poi = {
  pageId: 300,
  title: 'LLM Suggestion',
  latitude: 37.4275, // placeholder coords — equal to user GPS
  longitude: -122.1697,
  distanceMeters: 0,
  source: 'llm',
};

describe('useProximityNarration', () => {
  let nowSpy: jest.SpyInstance<number, []>;
  let currentNow: number;

  beforeEach(() => {
    currentNow = 1_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => currentNow);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('does not fire when enabled is false', () => {
    const onNarrate = jest.fn();
    render(el({ gps: STANFORD, pois: [HOOVER_TOWER], onNarrate, enabled: false }));
    expect(onNarrate).not.toHaveBeenCalled();
  });

  it('does not fire for POIs whose source is "llm"', () => {
    const onNarrate = jest.fn();
    render(el({ gps: STANFORD, pois: [LLM_POI], onNarrate, enabled: true }));
    expect(onNarrate).not.toHaveBeenCalled();
  });

  it('fires onNarrate when a Wikipedia POI is within the proximity threshold', () => {
    const onNarrate = jest.fn();
    render(el({ gps: STANFORD, pois: [HOOVER_TOWER], onNarrate, enabled: true }));
    expect(onNarrate).toHaveBeenCalledTimes(1);
    expect(onNarrate).toHaveBeenCalledWith(HOOVER_TOWER);
  });

  it('does not fire when the only Wikipedia POI is outside the threshold', () => {
    const onNarrate = jest.fn();
    render(el({ gps: STANFORD, pois: [FAR_POI], onNarrate, enabled: true }));
    expect(onNarrate).not.toHaveBeenCalled();
  });

  it('does not re-fire for the same POI once it has been narrated', () => {
    const onNarrate = jest.fn();
    const { rerender } = render(
      el({ gps: STANFORD, pois: [HOOVER_TOWER], onNarrate, enabled: true })
    );
    expect(onNarrate).toHaveBeenCalledTimes(1);

    // Advance the clock past the cooldown so the cooldown itself can't be
    // what suppresses the second firing — only the "already narrated" set.
    currentNow += 60_000;

    // A new POI list reference with the same POI triggers the effect again.
    rerender(el({ gps: STANFORD, pois: [{ ...HOOVER_TOWER }], onNarrate, enabled: true }));
    expect(onNarrate).toHaveBeenCalledTimes(1);
  });

  it('honors the 30 s cooldown between firings', () => {
    const onNarrate = jest.fn();
    const secondPoi: Poi = {
      pageId: 101,
      title: 'Stanford Memorial Church',
      latitude: 37.4275,
      longitude: -122.1697,
      distanceMeters: 0,
      source: 'wikipedia',
    };

    const { rerender } = render(
      el({ gps: STANFORD, pois: [HOOVER_TOWER], onNarrate, enabled: true })
    );
    expect(onNarrate).toHaveBeenCalledTimes(1);

    // Only 10 s later — cooldown (30 s) should still block the next firing
    // even though the POI itself is new (different pageId).
    currentNow += 10_000;
    rerender(el({ gps: STANFORD, pois: [secondPoi], onNarrate, enabled: true }));
    expect(onNarrate).toHaveBeenCalledTimes(1);

    // Past the cooldown — should fire for the new POI.
    currentNow += 25_000;
    rerender(el({ gps: STANFORD, pois: [secondPoi], onNarrate, enabled: true }));
    expect(onNarrate).toHaveBeenCalledTimes(2);
    expect(onNarrate).toHaveBeenLastCalledWith(secondPoi);
  });
});
