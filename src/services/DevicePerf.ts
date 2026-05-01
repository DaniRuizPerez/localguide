/**
 * DevicePerf — EWMA-based LLM streaming speed classifier.
 *
 * Classifies the device as 'fast' or 'slow' based on the measured rate of
 * appendGuideToken callbacks ("deltas/sec") during LLM streaming.  The
 * classification drives online-mode routing: slow devices short-circuit to
 * source-first delivery rather than waiting 20+ seconds for Gemma.
 *
 * Persistence: AsyncStorage key '@devicePerf:v1', JSON
 *   { ewma: number, samples: number, lastUpdate: string }
 * Writes are debounced to at most once every 5 seconds.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { totalMemory as expoTotalMemory } from 'expo-device';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * Slow-device threshold in deltas/sec.
 *
 * Calibrated 2026-05-01 on Pixel 3 (4 GB RAM, API 30, Gemma 4 E2B via
 * LiteRT-LM CPU, 4 threads). Two history-style chat prompts measured:
 *   - Sample 1: 1.57 deltas/sec (94.5 s response)
 *   - Sample 2: ~4.20 deltas/sec  (EWMA after both: 2.36)
 * Pixel 3 sits at ~1.5–4 deltas/sec. Modern Hermes devices stream LLM
 * deltas at ~20–50/s. THRESHOLD=8 leaves a clear gap above Pixel 3's
 * worst case while still flagging borderline mid-range Android as slow.
 *
 * Re-tune if the model or runtime changes (e.g. swapping LiteRT for
 * MediaPipe Tasks, or moving from Gemma 4 E2B to a larger variant).
 */
const THRESHOLD = 8;

/** EWMA smoothing factor. Higher alpha = more weight on recent samples. */
const ALPHA = 0.3;

/** Minimum stream duration to count as a measurement (noise gate). */
const MIN_DURATION_MS = 500;

/** Minimum samples before deltasPerSecond() returns a non-null value. */
const MIN_SAMPLES = 3;

/** Debounce interval for AsyncStorage writes (ms). */
const SAVE_DEBOUNCE_MS = 5_000;

/** AsyncStorage key for persisted EWMA state. */
const STORAGE_KEY = '@devicePerf:v1';

/** 6 GB expressed in bytes — cold-start "slow" RAM threshold. */
const SLOW_RAM_THRESHOLD_BYTES = 6 * 1024 * 1024 * 1024;

/** Android API level below which the device is classified 'slow'. */
const SLOW_API_LEVEL = 31;

// ---------------------------------------------------------------------------
// Persisted shape
// ---------------------------------------------------------------------------

interface PersistedPerf {
  ewma: number;
  samples: number;
  lastUpdate: string;
}

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

let ewma: number | null = null;
let samples = 0;
let loaded = false;
let loading: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Cold-start fallback (computed lazily, cached after first call)
// ---------------------------------------------------------------------------

let _coldStartClass: 'fast' | 'slow' | null = null;

function coldStartClass(): 'fast' | 'slow' {
  if (_coldStartClass !== null) return _coldStartClass;

  // Android API level check.
  if (Platform.OS === 'android') {
    const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
    if (Number.isFinite(apiLevel) && apiLevel < SLOW_API_LEVEL) {
      _coldStartClass = 'slow';
      return _coldStartClass;
    }
  }

  // RAM check via expo-device (may be null on some devices / in tests).
  const ram = expoTotalMemory;
  if (typeof ram === 'number' && ram < SLOW_RAM_THRESHOLD_BYTES) {
    _coldStartClass = 'slow';
    return _coldStartClass;
  }

  _coldStartClass = 'fast';
  return _coldStartClass;
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function scheduleSave(): void {
  if (saveTimer !== null) return; // already pending
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (ewma !== null) {
      const payload: PersistedPerf = {
        ewma,
        samples,
        lastUpdate: new Date().toISOString(),
      };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload)).catch(() => {
        // Persistence failures are non-fatal; in-memory state is authoritative.
      });
    }
  }, SAVE_DEBOUNCE_MS);
}

function ensureLoaded(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loading) return loading;
  loading = AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as PersistedPerf;
          if (
            typeof parsed.ewma === 'number' &&
            typeof parsed.samples === 'number' &&
            parsed.samples >= 0
          ) {
            ewma = parsed.ewma;
            samples = parsed.samples;
          }
        } catch {
          // Corrupt storage — start fresh.
        }
      }
    })
    .catch(() => {
      // Storage unavailable — start fresh.
    })
    .finally(() => {
      loaded = true;
      loading = null;
    });
  return loading;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DevicePerf {
  /**
   * Record the result of a completed LLM stream.
   * Updates the EWMA and schedules a debounced persist.
   * Calls with durationMs < 500 are silently ignored (noise gate).
   */
  recordStream(deltaCount: number, durationMs: number): void;

  /**
   * Current EWMA of deltas/sec over recent streams.
   * Returns null until at least 3 samples have been recorded
   * (counting persisted samples from previous sessions).
   */
  deltasPerSecond(): number | null;

  /**
   * Classify this device as 'fast', 'slow', or 'unknown'.
   * 'unknown' is only returned in the brief window before even the
   * cold-start heuristic has been evaluated (practically never, since
   * coldStartClass() runs synchronously on first call).
   *
   * Classification priority:
   *  1. If samples >= 3, use the measured EWMA vs. THRESHOLD.
   *  2. Otherwise fall back to the cold-start heuristic (expo-device +
   *     Platform.Version).
   */
  perfClass(): 'fast' | 'slow' | 'unknown';

  /** @internal Test-only: reset all in-memory state. */
  __resetForTest(): void;
  /** @internal Test-only: await the pending AsyncStorage load (if any). */
  __hydrateForTest(): Promise<void>;
}

export const devicePerf: DevicePerf = {
  recordStream(deltaCount: number, durationMs: number): void {
    if (durationMs < MIN_DURATION_MS) return;
    const rate = deltaCount / (durationMs / 1000);
    if (ewma === null) {
      ewma = rate;
    } else {
      ewma = ALPHA * rate + (1 - ALPHA) * ewma;
    }
    samples += 1;
    scheduleSave();
    // Also trigger a load so future reads have fresh persisted state if this
    // is the first call on a fresh session.
    ensureLoaded().catch(() => {});
  },

  deltasPerSecond(): number | null {
    if (samples < MIN_SAMPLES || ewma === null) return null;
    return ewma;
  },

  perfClass(): 'fast' | 'slow' | 'unknown' {
    const dps = this.deltasPerSecond();
    if (dps !== null) {
      return dps < THRESHOLD ? 'slow' : 'fast';
    }
    // Fall back to cold-start heuristic.
    return coldStartClass();
  },

  __resetForTest(): void {
    ewma = null;
    samples = 0;
    loaded = false;
    loading = null;
    _coldStartClass = null;
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  },

  __hydrateForTest(): Promise<void> {
    loaded = false;
    loading = null;
    return ensureLoaded();
  },
};

// Kick off the load eagerly so state is ready by the time the first stream
// completes.  Failures are swallowed — the cold-start fallback covers the
// window before measurements are available.
ensureLoaded().catch(() => {});
