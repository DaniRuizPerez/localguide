/**
 * B2 — breadcrumb trail service. Verifies distance-based dedupe, midnight
 * reset, subscription notifications, persistence round-trip, and clear().
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { breadcrumbTrail } from '../services/BreadcrumbTrail';

const PARIS_ISH = { lat: 48.8566, lon: 2.3522 };

describe('BreadcrumbTrail', () => {
  beforeEach(async () => {
    breadcrumbTrail.__resetForTest();
    await AsyncStorage.clear();
  });

  it('starts empty', () => {
    expect(breadcrumbTrail.getPoints()).toEqual([]);
  });

  it('records a new point when the user walks far enough', () => {
    breadcrumbTrail.record(PARIS_ISH.lat, PARIS_ISH.lon, 1_000);
    // ~150 m north
    breadcrumbTrail.record(PARIS_ISH.lat + 0.00135, PARIS_ISH.lon, 2_000);
    expect(breadcrumbTrail.getPoints()).toHaveLength(2);
  });

  it('de-dupes jitter (< 10 m from the last point)', () => {
    breadcrumbTrail.record(PARIS_ISH.lat, PARIS_ISH.lon, 1_000);
    // ~1 m shift
    breadcrumbTrail.record(PARIS_ISH.lat + 0.00001, PARIS_ISH.lon, 2_000);
    expect(breadcrumbTrail.getPoints()).toHaveLength(1);
  });

  it('resets when the local date changes between record() calls', () => {
    const day1 = new Date('2026-04-20T23:59:00').getTime();
    const day2 = new Date('2026-04-21T00:01:00').getTime();
    breadcrumbTrail.record(PARIS_ISH.lat, PARIS_ISH.lon, day1);
    expect(breadcrumbTrail.getPoints()).toHaveLength(1);

    breadcrumbTrail.record(PARIS_ISH.lat, PARIS_ISH.lon + 0.01, day2);
    // The cross-midnight record() clears yesterday and records today's first.
    expect(breadcrumbTrail.getPoints()).toHaveLength(1);
    expect(breadcrumbTrail.getDateKey()).toBe('2026-04-21');
  });

  it('notifies subscribers on record() and clear()', () => {
    const listener = jest.fn();
    const unsub = breadcrumbTrail.subscribe(listener);
    breadcrumbTrail.record(PARIS_ISH.lat, PARIS_ISH.lon);
    expect(listener).toHaveBeenCalledTimes(1);

    breadcrumbTrail.clear();
    expect(listener).toHaveBeenCalledTimes(2);
    unsub();
    breadcrumbTrail.record(PARIS_ISH.lat, PARIS_ISH.lon);
    expect(listener).toHaveBeenCalledTimes(2); // unsubscribed
  });

  it('clear() on an empty trail is a no-op (no notify)', () => {
    const listener = jest.fn();
    breadcrumbTrail.subscribe(listener);
    breadcrumbTrail.clear();
    expect(listener).not.toHaveBeenCalled();
  });

  it('persists across instances (hydrate reads back same-day data)', async () => {
    jest.useFakeTimers();
    try {
      const today = Date.now();
      breadcrumbTrail.record(PARIS_ISH.lat, PARIS_ISH.lon, today);
      breadcrumbTrail.record(PARIS_ISH.lat + 0.002, PARIS_ISH.lon, today + 1_000);
      // Drain the 2s debounce timer.
      jest.advanceTimersByTime(2_500);
    } finally {
      jest.useRealTimers();
    }
    // Let the AsyncStorage.setItem microtask settle.
    await new Promise((r) => setImmediate(r));

    breadcrumbTrail.__resetForTest();
    await breadcrumbTrail.hydrate();
    expect(breadcrumbTrail.getPoints().length).toBeGreaterThanOrEqual(1);
  });

  it('ignores stored data from a previous day', async () => {
    const y = new Date('2020-01-01T12:00:00').getTime();
    const yesterdayPayload = {
      dateKey: '2020-01-01',
      points: [{ latitude: 1, longitude: 2, t: y }],
    };
    await AsyncStorage.setItem('@localguide/breadcrumb-v1', JSON.stringify(yesterdayPayload));

    breadcrumbTrail.__resetForTest();
    await breadcrumbTrail.hydrate();
    expect(breadcrumbTrail.getPoints()).toEqual([]);
  });
});
