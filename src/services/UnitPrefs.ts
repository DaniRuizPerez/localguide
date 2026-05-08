import { createPersistedStore } from './persistedStore';

export interface UnitPrefsState {
  units: 'km' | 'miles';
}

function defaultUnits(): 'km' | 'miles' {
  try {
    const locale = Intl.NumberFormat().resolvedOptions().locale; // e.g. "en-US"
    // US is the only major locale that uses miles for short distances. UK/Liberia/Myanmar
    // technically use miles too but they're rare in our user base; users there can flip
    // the toggle in Settings.
    if (locale.startsWith('en-US')) return 'miles';
    return 'km';
  } catch {
    return 'km';
  }
}

const DEFAULTS: UnitPrefsState = {
  units: defaultUnits(),
};

function isValidUnits(v: unknown): v is 'km' | 'miles' {
  return v === 'km' || v === 'miles';
}

const store = createPersistedStore<UnitPrefsState>({
  storageKey: '@localguide/unit-prefs-v1',
  defaults: DEFAULTS,
  validate: (raw, defaults) => {
    if (!raw || typeof raw !== 'object') return defaults;
    const obj = raw as Record<string, unknown>;
    return {
      units: isValidUnits(obj.units) ? obj.units : defaults.units,
    };
  },
});

export const unitPrefs = {
  hydrate: () => store.hydrate(),

  get(): UnitPrefsState {
    return store.get();
  },

  set(units: 'km' | 'miles'): void {
    if (!isValidUnits(units)) return;
    store.set({ units });
  },

  subscribe(listener: (p: UnitPrefsState) => void): () => void {
    return store.subscribe(listener);
  },

  __resetForTest(): void {
    store.__resetForTest();
  },
};

// Kick off hydration at module load so the persisted unit preference is in
// effect by first render, mirroring the RadiusPrefs boot-time hydration pattern.
unitPrefs.hydrate().catch(() => {});
