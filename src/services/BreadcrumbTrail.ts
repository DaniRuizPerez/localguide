import { createPersistedStore } from './persistedStore';

// Keeps a polyline of where the user walked today. Persisted so reopening
// the app mid-tour doesn't lose the trail, and reset at local midnight so
// yesterday's trail doesn't clutter today's map.
//
// Purely additive: only writes new points when they're a meaningful
// distance from the last one (default 10 m) so idle GPS jitter doesn't
// fill the buffer with 10,000 near-identical samples.

export interface BreadcrumbPoint {
  latitude: number;
  longitude: number;
  t: number; // epoch ms when captured
}

interface TrailState {
  dateKey: string; // YYYY-MM-DD local
  points: BreadcrumbPoint[];
}

const MIN_STEP_METERS = 10;
// Cap so a long-distance user doesn't blow past memory. 10km at 10m steps
// is 1000 points; this gives a comfortable 15x safety margin.
const MAX_POINTS = 15_000;

function localDateKey(timestamp: number = Date.now()): string {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const store = createPersistedStore<TrailState>({
  storageKey: '@localguide/breadcrumb-v1',
  defaults: { dateKey: localDateKey(), points: [] },
  // Drop yesterday's trail at hydrate time.
  validate: (raw, defaults) => {
    if (!raw || typeof raw !== 'object') return defaults;
    const r = raw as Record<string, unknown>;
    const today = localDateKey();
    if (r.dateKey !== today) return { dateKey: today, points: [] };
    const points = Array.isArray(r.points)
      ? (r.points as BreadcrumbPoint[]).filter(
          (p) =>
            typeof p.latitude === 'number' &&
            typeof p.longitude === 'number' &&
            typeof p.t === 'number'
        )
      : [];
    return { dateKey: today, points };
  },
  saveDebounceMs: 2000,
});

// Public subscribe API takes just the points array (subscribers never read
// the dateKey). Re-registered after __resetForTest so tests that reset
// between beforeEach blocks keep a working notification path.
const pointsListeners = new Set<(points: BreadcrumbPoint[]) => void>();
function wireStoreForward(): void {
  store.subscribe((s) => {
    for (const l of pointsListeners) l(s.points);
  });
}
wireStoreForward();

export const breadcrumbTrail = {
  hydrate: () => store.hydrate(),

  getPoints(): BreadcrumbPoint[] {
    return store.get().points;
  },

  getDateKey(): string {
    return store.get().dateKey;
  },

  /**
   * Record a new GPS fix. No-op if the caller is still close enough to the
   * previous point, or if midnight has passed since load (auto-reset).
   */
  record(latitude: number, longitude: number, timestamp: number = Date.now()): void {
    const today = localDateKey(timestamp);
    const state = store.get();
    if (today !== state.dateKey) {
      store.set({ dateKey: today, points: [] });
      return this.record(latitude, longitude, timestamp);
    }
    const last = state.points[state.points.length - 1];
    if (last && haversine(last.latitude, last.longitude, latitude, longitude) < MIN_STEP_METERS) {
      return;
    }
    const next: BreadcrumbPoint[] = [
      ...state.points,
      { latitude, longitude, t: timestamp },
    ];
    const capped =
      next.length > MAX_POINTS ? next.slice(next.length - MAX_POINTS) : next;
    store.set({ points: capped });
  },

  clear(): void {
    if (store.get().points.length === 0) return;
    store.set({ points: [] });
  },

  subscribe(listener: (points: BreadcrumbPoint[]) => void): () => void {
    pointsListeners.add(listener);
    return () => {
      pointsListeners.delete(listener);
    };
  },

  __resetForTest(): void {
    store.__resetForTest();
    pointsListeners.clear();
    wireStoreForward();
  },
};
