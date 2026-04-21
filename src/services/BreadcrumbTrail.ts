import AsyncStorage from '@react-native-async-storage/async-storage';

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

interface StoredShape {
  dateKey: string; // YYYY-MM-DD local
  points: BreadcrumbPoint[];
}

const STORAGE_KEY = '@localguide/breadcrumb-v1';
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

let points: BreadcrumbPoint[] = [];
let dateKey: string = localDateKey();
let loaded = false;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<(points: BreadcrumbPoint[]) => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function notify(): void {
  for (const l of listeners) l(points);
}

async function load(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredShape;
      const today = localDateKey();
      if (parsed.dateKey === today && Array.isArray(parsed.points)) {
        points = parsed.points.filter(
          (p) =>
            typeof p.latitude === 'number' &&
            typeof p.longitude === 'number' &&
            typeof p.t === 'number'
        );
        dateKey = today;
      } else {
        // Stored data is from yesterday (or earlier) — reset.
        points = [];
        dateKey = today;
        AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
      }
    }
  } catch {
    // Corrupt or missing — keep the empty trail we started with.
  } finally {
    loaded = true;
  }
}

function scheduleSave(): void {
  // Coalesce saves — GPS can fire every second, we don't want a write per tick.
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const payload: StoredShape = { dateKey, points };
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload)).catch(() => {});
  }, 2000);
}

export const breadcrumbTrail = {
  hydrate(): Promise<void> {
    if (loaded) return Promise.resolve();
    if (!loadPromise) loadPromise = load();
    return loadPromise;
  },

  /**
   * Record a new GPS fix. No-op if the caller is still close enough to the
   * previous point, or if midnight has passed since load (auto-reset).
   */
  record(latitude: number, longitude: number, timestamp: number = Date.now()): void {
    const today = localDateKey(timestamp);
    if (today !== dateKey) {
      dateKey = today;
      points = [];
      notify();
    }
    const last = points[points.length - 1];
    if (last && haversine(last.latitude, last.longitude, latitude, longitude) < MIN_STEP_METERS) {
      return;
    }
    points.push({ latitude, longitude, t: timestamp });
    if (points.length > MAX_POINTS) {
      // Drop from the head so the tail (recent history) stays intact.
      points = points.slice(points.length - MAX_POINTS);
    }
    scheduleSave();
    notify();
  },

  clear(): void {
    if (points.length === 0) return;
    points = [];
    scheduleSave();
    notify();
  },

  getPoints(): BreadcrumbPoint[] {
    return points;
  },

  getDateKey(): string {
    return dateKey;
  },

  subscribe(listener: (points: BreadcrumbPoint[]) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  __resetForTest(): void {
    points = [];
    dateKey = localDateKey();
    loaded = false;
    loadPromise = null;
    listeners.clear();
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  },
};
