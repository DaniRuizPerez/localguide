import { createPersistedStore } from './persistedStore';

export interface RadiusPrefsState {
  radiusMeters: number; // 2000 | 5000 | 10000 | 20000
}

export const VALID_RADII = [2000, 5000, 10000, 20000] as const;
export const DEFAULT_RADIUS = 5000;
type ValidRadius = (typeof VALID_RADII)[number];

const DEFAULTS: RadiusPrefsState = {
  radiusMeters: DEFAULT_RADIUS,
};

function isValidRadius(v: unknown): v is ValidRadius {
  return VALID_RADII.includes(v as ValidRadius);
}

const store = createPersistedStore<RadiusPrefsState>({
  storageKey: '@localguide/radius-prefs-v1',
  defaults: DEFAULTS,
  validate: (raw, defaults) => {
    if (!raw || typeof raw !== 'object') return defaults;
    const obj = raw as Record<string, unknown>;
    // Migration: if the stored value (e.g. 1000 m from the old valid set) is no
    // longer in VALID_RADII, clamp to the default and let the store persist it
    // immediately on the next scheduleSave triggered by hydrate's set() call.
    return {
      radiusMeters: isValidRadius(obj.radiusMeters) ? obj.radiusMeters : defaults.radiusMeters,
    };
  },
});

export const radiusPrefs = {
  hydrate: () => store.hydrate(),

  get(): RadiusPrefsState {
    return store.get();
  },

  set(meters: number): void {
    if (!isValidRadius(meters)) return;
    store.set({ radiusMeters: meters });
  },

  subscribe(listener: (p: RadiusPrefsState) => void): () => void {
    return store.subscribe(listener);
  },

  __resetForTest(): void {
    store.__resetForTest();
  },
};

// Kick off hydration at module load so the persisted radius is in effect by
// first render, mirroring GuidePrefs' boot-time hydration pattern.
radiusPrefs.hydrate().catch(() => {});
