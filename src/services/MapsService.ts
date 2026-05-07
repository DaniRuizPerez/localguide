// Google Directions API wrapper. Returns walking duration in minutes between
// two coordinates, or null on every failure path (no key, network error,
// ZERO_RESULTS). Callers can no-op gracefully when null is returned.
import Constants from 'expo-constants';

const FETCH_TIMEOUT_MS = 8000;
const CACHE_MAX_SIZE = 128;
// 4 decimal places ≈ 11 m resolution — fine for walking-time purposes.
const KEY_PRECISION = 4;

function readApiKey(): string | null {
  // Prefer EXPO_PUBLIC_GOOGLE_MAPS_API_KEY so the same .env value drives both
  // the native MapView gate (MapScreen) and the Directions REST call here —
  // one source of truth, no risk of drift. Fall back to app.json's
  // extra.googleMapsApiKey for callers that prefer Expo config injection.
  const fromEnv = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return fromEnv.trim();
  const raw = (Constants.expoConfig?.extra as Record<string, unknown> | undefined)
    ?.googleMapsApiKey;
  if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
  return null;
}

function cacheKey(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number
): string {
  return (
    `${fromLat.toFixed(KEY_PRECISION)}_${fromLon.toFixed(KEY_PRECISION)}` +
    `_${toLat.toFixed(KEY_PRECISION)}_${toLon.toFixed(KEY_PRECISION)}`
  );
}

// Minimal LRU: Map preserves insertion order; on each access we delete + re-insert
// so the most-recently-used entry sits at the end. Evict the oldest (first) entry
// when we exceed the cap. No TTL — walking times are stable across a session.
const lruCache = new Map<string, number>();

function lruGet(key: string): number | undefined {
  if (!lruCache.has(key)) return undefined;
  const val = lruCache.get(key)!;
  lruCache.delete(key);
  lruCache.set(key, val);
  return val;
}

function lruSet(key: string, val: number): void {
  if (lruCache.has(key)) lruCache.delete(key);
  lruCache.set(key, val);
  if (lruCache.size > CACHE_MAX_SIZE) {
    // Evict the least-recently-used entry (first in insertion order).
    const oldest = lruCache.keys().next().value;
    if (oldest !== undefined) lruCache.delete(oldest);
  }
}

interface DirectionsResponse {
  status: string;
  routes: Array<{
    legs: Array<{
      duration: { value: number };
    }>;
  }>;
}

export const mapsService = {
  isConfigured(): boolean {
    return readApiKey() !== null;
  },

  async walkingTime(
    from: { lat: number; lon: number },
    to: { lat: number; lon: number },
    opts?: { signal?: AbortSignal }
  ): Promise<number | null> {
    const key = readApiKey();
    if (key === null) return null;

    const ck = cacheKey(from.lat, from.lon, to.lat, to.lon);
    const cached = lruGet(ck);
    if (cached !== undefined) return cached;

    const url =
      `https://maps.googleapis.com/maps/api/directions/json` +
      `?origin=${from.lat},${from.lon}` +
      `&destination=${to.lat},${to.lon}` +
      `&mode=walking` +
      `&key=${key}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    // Merge caller signal: if the caller aborts, forward to our controller.
    let callerAbortHandler: (() => void) | null = null;
    if (opts?.signal) {
      callerAbortHandler = () => controller.abort();
      opts.signal.addEventListener('abort', callerAbortHandler);
    }

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return null;
      const data = (await response.json()) as DirectionsResponse;
      if (
        data.status !== 'OK' ||
        !data.routes?.[0]?.legs?.[0]?.duration?.value
      ) {
        return null;
      }
      const minutes = Math.round(data.routes[0].legs[0].duration.value / 60);
      lruSet(ck, minutes);
      return minutes;
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
      if (opts?.signal && callerAbortHandler) {
        opts.signal.removeEventListener('abort', callerAbortHandler);
      }
    }
  },

  async walkingTimes(
    from: { lat: number; lon: number },
    tos: { lat: number; lon: number }[]
  ): Promise<(number | null)[]> {
    return Promise.all(tos.map((to) => this.walkingTime(from, to)));
  },

  // Exposed for tests only — clears the in-memory LRU so test runs don't
  // bleed cached values into each other.
  clearCache(): void {
    lruCache.clear();
  },
};
