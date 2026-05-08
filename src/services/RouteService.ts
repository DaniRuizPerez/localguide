/**
 * RouteService — OSRM walking-time matrix wrapper.
 *
 * Calls the free OSRM public demo server to get an N×N matrix of walking
 * durations (seconds → minutes) and distances (metres). Falls back to
 * haversine per-cell when OSRM returns a null for an unreachable pair.
 * Returns null for the whole matrix on network failure, non-OK HTTP,
 * or 6 s timeout.
 *
 * Cache layers:
 *   1. In-memory LRU (32 entries) — instant hit for same-session re-opens.
 *   2. AsyncStorage with 24 h TTL — survives app restarts; avoids OSRM
 *      traffic when the user re-opens an itinerary the next morning.
 *
 * Fair-use: single user, one call per fresh itinerary open, 24 h cache.
 * OSRM soft rate limit is ~1 req/sec; we're well under.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { distanceMeters } from './PoiService';

// ─── Constants ────────────────────────────────────────────────────────────────

const OSRM_BASE = 'https://router.project-osrm.org/table/v1/foot';
const USER_AGENT = 'LocalGuide/1.0 (https://github.com/DaniRuizPerez/localguide)';
const FETCH_TIMEOUT_MS = 6000;
// 16 = user position + 15 ranked POIs (AROUND_YOU_CAP). OSRM's table demo
// allows up to 100 sources, so 16 is well within fair-use; ItineraryModal's
// caller still tops out at ~8 stops.
const COORD_CAP = 16;
const STORAGE_PREFIX = 'route-matrix:';
const STORAGE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h
const LRU_MAX = 32;

// Walking speed for haversine fallback: 5 km/h = 5000 m / 60 min
const WALK_MPS = 5000 / 60; // metres per minute

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WalkingMatrix {
  minutes: number[][];
  meters: number[][];
}

interface OsrmTableResponse {
  code: string;
  durations: (number | null)[][];
  distances: (number | null)[][];
}

interface StorageEntry {
  ts: number;
  data: WalkingMatrix;
}

// ─── In-memory LRU cache ──────────────────────────────────────────────────────

const lruCache = new Map<string, WalkingMatrix>();

function lruGet(key: string): WalkingMatrix | undefined {
  if (!lruCache.has(key)) return undefined;
  const val = lruCache.get(key)!;
  lruCache.delete(key);
  lruCache.set(key, val);
  return val;
}

function lruSet(key: string, val: WalkingMatrix): void {
  if (lruCache.has(key)) lruCache.delete(key);
  lruCache.set(key, val);
  if (lruCache.size > LRU_MAX) {
    const oldest = lruCache.keys().next().value;
    if (oldest !== undefined) lruCache.delete(oldest);
  }
}

// ─── Cache key ────────────────────────────────────────────────────────────────

/**
 * Stable hash from a list of coords.
 * Sort by lat+lon string so the key doesn't depend on input order.
 * Resolution: 5 decimal places ≈ 1.1 m — tight enough for route caching.
 */
function matrixCacheKey(coords: Array<{ lat: number; lon: number }>): string {
  const parts = coords
    .map((c) => `${c.lat.toFixed(5)},${c.lon.toFixed(5)}`)
    .sort();
  return parts.join('|');
}

// ─── Haversine helpers ────────────────────────────────────────────────────────

function haversineMinutes(
  coords: Array<{ lat: number; lon: number }>,
  i: number,
  j: number
): number {
  const m = distanceMeters(coords[i].lat, coords[i].lon, coords[j].lat, coords[j].lon);
  return Math.max(1, Math.round(m / WALK_MPS));
}

function haversineMeters(
  coords: Array<{ lat: number; lon: number }>,
  i: number,
  j: number
): number {
  return Math.round(distanceMeters(coords[i].lat, coords[i].lon, coords[j].lat, coords[j].lon));
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const routeService = {
  /**
   * Returns an N×N matrix of walking minutes and metres.
   * Returns null if the coord list exceeds COORD_CAP, or on any fetch failure.
   */
  async walkingTimeMatrix(
    coords: Array<{ lat: number; lon: number }>,
    opts?: { signal?: AbortSignal }
  ): Promise<WalkingMatrix | null> {
    // Hard cap — defend contract, no fetch.
    if (coords.length > COORD_CAP) {
      if (__DEV__) console.log(`[RouteService] matrix N=${coords.length} from=cap_exceeded`);
      return null;
    }

    const key = matrixCacheKey(coords);

    // 1. In-memory LRU hit.
    const memHit = lruGet(key);
    if (memHit) {
      if (__DEV__) console.log(`[RouteService] matrix N=${coords.length} from=memory`);
      return memHit;
    }

    // 2. AsyncStorage hit (cold start / previous session).
    try {
      const raw = await AsyncStorage.getItem(STORAGE_PREFIX + key);
      if (raw) {
        const entry: StorageEntry = JSON.parse(raw);
        if (Date.now() - entry.ts < STORAGE_TTL_MS) {
          lruSet(key, entry.data); // warm the in-memory cache too
          if (__DEV__) console.log(`[RouteService] matrix N=${coords.length} from=storage`);
          return entry.data;
        }
      }
    } catch {
      // Storage read failure is non-fatal — fall through to network.
    }

    // 3. Fetch from OSRM.
    const result = await routeService._fetchOsrm(coords, opts);
    if (!result) return null;

    // Cache the successful result.
    lruSet(key, result);
    try {
      const entry: StorageEntry = { ts: Date.now(), data: result };
      await AsyncStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
    } catch {
      // Storage write failure is non-fatal.
    }

    if (__DEV__) console.log(`[RouteService] matrix N=${coords.length} from=osrm`);
    return result;
  },

  /** Internal: fetch from OSRM, merge abort signals, apply conversions. */
  async _fetchOsrm(
    coords: Array<{ lat: number; lon: number }>,
    opts?: { signal?: AbortSignal }
  ): Promise<WalkingMatrix | null> {
    // Build the coord path — OSRM uses lon,lat order.
    const coordPath = coords.map((c) => `${c.lon},${c.lat}`).join(';');
    const url = `${OSRM_BASE}/${coordPath}?annotations=duration,distance`;

    // Merge caller signal with our own 6 s timeout signal.
    const timeoutAc = new AbortController();
    const timeoutId = setTimeout(() => timeoutAc.abort(), FETCH_TIMEOUT_MS);

    let combinedSignal: AbortSignal;
    if (opts?.signal) {
      // AbortSignal.any is not universally available in RN; wire both manually.
      const merged = new AbortController();
      const onAbort = () => merged.abort();
      opts.signal.addEventListener('abort', onAbort);
      timeoutAc.signal.addEventListener('abort', onAbort);
      combinedSignal = merged.signal;
      // Note: we don't clean up these listeners on success to keep it simple;
      // they'll be GC'd with the AbortController instances.
    } else {
      combinedSignal = timeoutAc.signal;
    }

    try {
      const response = await fetch(url, {
        signal: combinedSignal,
        headers: { 'User-Agent': USER_AGENT },
      });

      clearTimeout(timeoutId);

      if (!response.ok) return null;

      const json: OsrmTableResponse = await response.json();
      if (json.code !== 'Ok') return null;

      const n = coords.length;
      const minutes: number[][] = [];
      const meters: number[][] = [];

      for (let i = 0; i < n; i++) {
        minutes[i] = [];
        meters[i] = [];
        for (let j = 0; j < n; j++) {
          const dur = json.durations[i]?.[j] ?? null;
          const dist = json.distances[i]?.[j] ?? null;

          if (dur !== null) {
            minutes[i][j] = Math.max(1, Math.round(dur / 60));
          } else {
            // Haversine fallback for unreachable pairs.
            minutes[i][j] = haversineMinutes(coords, i, j);
          }

          if (dist !== null) {
            meters[i][j] = Math.round(dist);
          } else {
            meters[i][j] = haversineMeters(coords, i, j);
          }
        }
      }

      return { minutes, meters };
    } catch {
      clearTimeout(timeoutId);
      return null;
    }
  },

  /** Test helper: evict all in-memory LRU entries. */
  _clearMemoryCache(): void {
    lruCache.clear();
  },
};
