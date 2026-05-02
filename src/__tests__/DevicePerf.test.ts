/**
 * DevicePerf unit tests.
 *
 * Covers:
 *  1. Cold-start slow: totalMemory=4 GB → perfClass() === 'slow'
 *  2. Cold-start fast: totalMemory=8 GB, API 33 → perfClass() === 'fast'
 *  3. EWMA convergence: 5 records at 20 dps → deltasPerSecond() ≈ 20
 *  4. Threshold slow: 5 records at 8 dps → perfClass() === 'slow'
 *  5. Threshold fast: 5 records at 25 dps → perfClass() === 'fast'
 *  6. samples < 3 → deltasPerSecond() === null, perfClass() falls back to cold-start
 *  7. recordStream skips durationMs < 500
 *  8. Persistence round-trip: record → fresh module → state reloads from AsyncStorage
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports that use the mocked modules
// ---------------------------------------------------------------------------

// Controllable expo-device values.
let mockTotalMemory: number | null = 8 * 1024 * 1024 * 1024; // 8 GB default

jest.mock('expo-device', () => ({
  get totalMemory() {
    return mockTotalMemory;
  },
}));

// Controllable Platform mock.
let mockPlatformOS: string = 'android';
let mockPlatformVersion: number = 33;

jest.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockPlatformOS;
    },
    get Version() {
      return mockPlatformVersion;
    },
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Re-import DevicePerf as a fresh module (clears module-level state). */
function freshDevicePerf() {
  jest.resetModules();
  // Re-apply mocks after resetModules, since they get cleared too.
  jest.mock('expo-device', () => ({
    get totalMemory() {
      return mockTotalMemory;
    },
  }));
  jest.mock('react-native', () => ({
    Platform: {
      get OS() {
        return mockPlatformOS;
      },
      get Version() {
        return mockPlatformVersion;
      },
    },
  }));
  jest.mock('@react-native-async-storage/async-storage', () =>
    require('@react-native-async-storage/async-storage/jest/async-storage-mock')
  );
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../services/DevicePerf') as typeof import('../services/DevicePerf');
}

/**
 * Record N identical streams and wait for microtasks so async work settles.
 */
async function recordN(
  dp: import('../services/DevicePerf').DevicePerf,
  count: number,
  deltaCount: number,
  durationMs: number
): Promise<void> {
  for (let i = 0; i < count; i++) {
    dp.recordStream(deltaCount, durationMs);
  }
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(async () => {
  // Reset AsyncStorage between tests.
  await AsyncStorage.clear();
  // Reset defaults.
  mockTotalMemory = 8 * 1024 * 1024 * 1024;
  mockPlatformOS = 'android';
  mockPlatformVersion = 33;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.resetModules();
});

// ---------------------------------------------------------------------------
// 1. Cold-start slow: 4 GB RAM
// ---------------------------------------------------------------------------
describe('Cold-start fallback', () => {
  it('classifies as slow when totalMemory < 6 GB', () => {
    mockTotalMemory = 4 * 1024 * 1024 * 1024; // 4 GB
    mockPlatformOS = 'android';
    mockPlatformVersion = 33;

    const { devicePerf } = freshDevicePerf();
    devicePerf.__resetForTest();

    expect(devicePerf.perfClass()).toBe('slow');
  });

  // ---------------------------------------------------------------------------
  // 2. Cold-start fast: 8 GB RAM, API 33
  // ---------------------------------------------------------------------------
  it('classifies as fast when totalMemory >= 6 GB and API >= 31', () => {
    mockTotalMemory = 8 * 1024 * 1024 * 1024; // 8 GB
    mockPlatformOS = 'android';
    mockPlatformVersion = 33;

    const { devicePerf } = freshDevicePerf();
    devicePerf.__resetForTest();

    expect(devicePerf.perfClass()).toBe('fast');
  });

  it('classifies as slow when API level < 31 regardless of RAM', () => {
    mockTotalMemory = 8 * 1024 * 1024 * 1024; // 8 GB — would be fast by RAM alone
    mockPlatformOS = 'android';
    mockPlatformVersion = 30; // Pixel 3 = API 30

    const { devicePerf } = freshDevicePerf();
    devicePerf.__resetForTest();

    expect(devicePerf.perfClass()).toBe('slow');
  });
});

// ---------------------------------------------------------------------------
// 3. EWMA convergence: 5 records at 20 dps → ~20
// ---------------------------------------------------------------------------
describe('EWMA recorder', () => {
  it('converges toward the input rate after 5 identical records', async () => {
    const { devicePerf } = freshDevicePerf();
    devicePerf.__resetForTest();

    // 100 deltas over 5 000 ms = 20 dps
    await recordN(devicePerf, 5, 100, 5_000);

    const dps = devicePerf.deltasPerSecond();
    expect(dps).not.toBeNull();
    // EWMA after 5 steps starting from 20: should be very close to 20.
    expect(dps!).toBeGreaterThan(18);
    expect(dps!).toBeLessThan(22);
  });

  // ---------------------------------------------------------------------------
  // 7. recordStream skips durationMs < 500
  // ---------------------------------------------------------------------------
  it('ignores streams with durationMs < 500', async () => {
    const { devicePerf } = freshDevicePerf();
    devicePerf.__resetForTest();

    // Three "real" records so we can check deltasPerSecond().
    await recordN(devicePerf, 3, 100, 5_000); // 20 dps each — so ewma ≈ 20

    const baselineDps = devicePerf.deltasPerSecond()!;

    // Now fire a short-duration record that should be ignored.
    devicePerf.recordStream(1000, 400); // 2500 dps if counted
    const afterDps = devicePerf.deltasPerSecond()!;

    // If the short record was ignored the ewma should not have moved.
    expect(afterDps).toBeCloseTo(baselineDps, 5);
  });
});

// ---------------------------------------------------------------------------
// 4 & 5. Threshold classification
// ---------------------------------------------------------------------------
describe('perfClass threshold', () => {
  it('returns slow when measured dps < THRESHOLD', async () => {
    const { devicePerf } = freshDevicePerf();
    devicePerf.__resetForTest();

    // 4 dps (well below threshold of 8 — Pixel 3 lives around here).
    await recordN(devicePerf, 5, 20, 5_000);

    expect(devicePerf.perfClass()).toBe('slow');
  });

  it('returns fast when measured dps >= THRESHOLD', async () => {
    const { devicePerf } = freshDevicePerf();
    devicePerf.__resetForTest();

    // 25 dps (well above threshold of 8 — modern Hermes device).
    await recordN(devicePerf, 5, 125, 5_000);

    expect(devicePerf.perfClass()).toBe('fast');
  });
});

// ---------------------------------------------------------------------------
// 6. samples < 3 → deltasPerSecond() === null, falls back to cold-start
// ---------------------------------------------------------------------------
describe('samples < 3 falls back to cold-start', () => {
  it('deltasPerSecond() is null until 3 samples', async () => {
    const { devicePerf } = freshDevicePerf();
    devicePerf.__resetForTest();

    devicePerf.recordStream(100, 5_000);
    expect(devicePerf.deltasPerSecond()).toBeNull();

    devicePerf.recordStream(100, 5_000);
    expect(devicePerf.deltasPerSecond()).toBeNull();

    devicePerf.recordStream(100, 5_000);
    // Now we have 3 samples — should return a number.
    expect(devicePerf.deltasPerSecond()).not.toBeNull();
  });

  it('perfClass() uses cold-start fallback when samples < 3', async () => {
    // Force cold-start to 'slow' via low RAM.
    mockTotalMemory = 4 * 1024 * 1024 * 1024;
    const { devicePerf } = freshDevicePerf();
    devicePerf.__resetForTest();

    // Only 2 records — should fall back to cold-start 'slow'.
    devicePerf.recordStream(100, 5_000);
    devicePerf.recordStream(100, 5_000);

    expect(devicePerf.deltasPerSecond()).toBeNull();
    expect(devicePerf.perfClass()).toBe('slow');
  });
});

// ---------------------------------------------------------------------------
// 8. Persistence round-trip
// ---------------------------------------------------------------------------
// Import the module-level devicePerf for persistence tests (no resetModules
// needed — we use __resetForTest + __hydrateForTest to simulate restarts within
// the same module, keeping AsyncStorage on the same mock instance).
import { devicePerf as sharedDevicePerf } from '../services/DevicePerf';

describe('persistence round-trip', () => {
  beforeEach(() => {
    sharedDevicePerf.__resetForTest();
  });

  it('reloads EWMA and samples from AsyncStorage after a simulated restart', async () => {
    // Simulate a "previous session" by writing persisted JSON directly.
    const persistedState = {
      ewma: 24.5,
      samples: 7,
      lastUpdate: new Date().toISOString(),
    };
    await AsyncStorage.setItem('@devicePerf:v1', JSON.stringify(persistedState));

    // Simulate restart: reset in-memory state then re-load from storage.
    sharedDevicePerf.__resetForTest();
    await sharedDevicePerf.__hydrateForTest();

    // samples=7 >= MIN_SAMPLES(3), so deltasPerSecond() should return the ewma.
    const dps = sharedDevicePerf.deltasPerSecond();
    expect(dps).not.toBeNull();
    expect(dps!).toBeCloseTo(24.5, 1);
    expect(sharedDevicePerf.perfClass()).toBe('fast'); // 24.5 > THRESHOLD(8)
  });

  it('writes EWMA state to AsyncStorage after debounce fires', async () => {
    sharedDevicePerf.__resetForTest();

    await recordN(sharedDevicePerf, 5, 125, 5_000); // 25 dps

    // Advance fake timers to trigger the 5-second debounce save.
    jest.advanceTimersByTime(5_100);
    // Flush the Promise chain for AsyncStorage.setItem.
    await Promise.resolve();
    await Promise.resolve();

    const stored = await AsyncStorage.getItem('@devicePerf:v1');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(typeof parsed.ewma).toBe('number');
    expect(parsed.samples).toBe(5);
    expect(typeof parsed.lastUpdate).toBe('string');
  });
});
