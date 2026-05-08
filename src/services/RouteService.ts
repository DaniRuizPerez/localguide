/**
 * RouteService — walking-distance matrix for nearby POIs and itineraries.
 *
 * Returns an N×N matrix of estimated walking metres + minutes between coord
 * pairs. Used by both the Around-You distance overlay and the Plan-My-Day
 * itinerary's TSP ordering + per-leg display.
 *
 * History: an earlier version called the OSRM public demo server's
 * `/table/v1/foot/...` endpoint expecting walking durations. The demo only
 * runs the *car* profile though — the foot path returns driving times
 * (~26 km/h implied speed) and driving distances (which detour around
 * freeways and ignore pedestrian shortcuts through campuses, parks, etc).
 * Both wrong for walking. The Plan-My-Day "≈ 37 min · 14.7 km" header on
 * a Stanford 8-stop tour was the giveaway — 14.7 km at car speed in 37 min.
 *
 * Replacement: haversine straight-line × 1.4 urban detour factor. 1.4 is the
 * standard rule-of-thumb for street-network distance over Euclidean in dense
 * urban areas (range ~1.2 in grid cities, up to 1.6 in winding suburbs).
 * Always free, instant, no network, no API key, and consistent: minutes is
 * always meters ÷ 5 km/h, so the displayed distance and time can never
 * disagree the way OSRM's car-vs-walking did.
 *
 * Trade-off: this can't account for actual pedestrian routing (it doesn't
 * know whether a creek has a bridge or not), but the previous OSRM
 * implementation didn't either — it gave car routing. For the kinds of
 * city/campus walks this app supports, haversine × 1.4 is well within the
 * uncertainty of the true walking time anyway. If a real foot-profile router
 * becomes useful (Valhalla, OpenRouteService self-hosted, etc.), swap the
 * implementation here without changing the public API.
 */

import { distanceMeters } from './PoiService';

// ─── Constants ────────────────────────────────────────────────────────────────

// 16 = user position + 15 ranked POIs (AROUND_YOU_CAP). Defends against
// future regressions; no real cost since we're computing locally.
const COORD_CAP = 16;
const LRU_MAX = 32;

// Walking speed: 5 km/h = 5000 m / 60 min ≈ 83.3 m/min.
const WALK_MPS = 5000 / 60;
// Urban detour factor: how much further the actual street-network walk is
// than the straight-line haversine. 1.4 is a well-known rule of thumb for
// dense urban / mixed campus areas; lower in pure grid cities, higher in
// winding suburbs. Tuned for Bay Area / Palo Alto.
const URBAN_DETOUR = 1.4;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WalkingMatrix {
  minutes: number[][];
  meters: number[][];
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

// ─── Service ──────────────────────────────────────────────────────────────────

export const routeService = {
  /**
   * Returns an N×N matrix of estimated walking minutes and metres.
   * Uses haversine × URBAN_DETOUR for distance and walking speed for time.
   * Returns null only when the coord list exceeds COORD_CAP.
   *
   * Async signature is preserved from the previous network-backed
   * implementation so existing call sites don't have to change.
   */
  async walkingTimeMatrix(
    coords: Array<{ lat: number; lon: number }>,
    _opts?: { signal?: AbortSignal }
  ): Promise<WalkingMatrix | null> {
    if (coords.length > COORD_CAP) {
      if (__DEV__) console.log(`[RouteService] matrix N=${coords.length} from=cap_exceeded`);
      return null;
    }

    const key = matrixCacheKey(coords);
    const memHit = lruGet(key);
    if (memHit) {
      if (__DEV__) console.log(`[RouteService] matrix N=${coords.length} from=memory`);
      return memHit;
    }

    const n = coords.length;
    const minutes: number[][] = [];
    const meters: number[][] = [];

    for (let i = 0; i < n; i++) {
      minutes[i] = [];
      meters[i] = [];
      for (let j = 0; j < n; j++) {
        if (i === j) {
          minutes[i][j] = 0;
          meters[i][j] = 0;
          continue;
        }
        const straight = distanceMeters(
          coords[i].lat,
          coords[i].lon,
          coords[j].lat,
          coords[j].lon
        );
        const m = Math.round(straight * URBAN_DETOUR);
        meters[i][j] = m;
        // Math.max(1, …) so ultra-short hops don't display "0 min walk".
        minutes[i][j] = Math.max(1, Math.round(m / WALK_MPS));
      }
    }

    const result: WalkingMatrix = { minutes, meters };
    lruSet(key, result);
    if (__DEV__) console.log(`[RouteService] matrix N=${coords.length} from=haversine`);
    return result;
  },

  /** Test helper: evict all in-memory LRU entries. */
  _clearMemoryCache(): void {
    lruCache.clear();
  },
};
