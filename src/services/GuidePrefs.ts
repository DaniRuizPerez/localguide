import AsyncStorage from '@react-native-async-storage/async-storage';

// Non-narration user preferences. Keeps the narration store focused on TTS/
// length concerns and makes room for additional UX toggles (hidden gems,
// exploration mode, etc.) without bloating NarrationPrefs.

export interface GuidePrefsShape {
  /**
   * When on, nearby-place lookups rank less-famous spots above the blockbuster
   * attractions, and the LLM fallback is instructed to pick offbeat locations.
   */
  hiddenGems: boolean;
}

const STORAGE_KEY = '@localguide/guide-prefs-v1';

const DEFAULTS: GuidePrefsShape = {
  hiddenGems: false,
};

let current: GuidePrefsShape = { ...DEFAULTS };
let loaded = false;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<(prefs: GuidePrefsShape) => void>();

async function load(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      current = {
        hiddenGems: typeof parsed.hiddenGems === 'boolean' ? parsed.hiddenGems : DEFAULTS.hiddenGems,
      };
    }
  } catch {
    // Corrupt storage — fall back to defaults.
  } finally {
    loaded = true;
  }
}

async function save(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Non-critical — pref will revert on next launch if storage is broken.
  }
}

function notify(): void {
  for (const l of listeners) l(current);
}

export const guidePrefs = {
  hydrate(): Promise<void> {
    if (loaded) return Promise.resolve();
    if (!loadPromise) loadPromise = load();
    return loadPromise;
  },

  get(): GuidePrefsShape {
    return current;
  },

  setHiddenGems(value: boolean): void {
    if (current.hiddenGems === value) return;
    current = { ...current, hiddenGems: value };
    save();
    notify();
  },

  subscribe(listener: (prefs: GuidePrefsShape) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  __resetForTest(): void {
    current = { ...DEFAULTS };
    loaded = false;
    loadPromise = null;
    listeners.clear();
  },
};

// Prompt directive asking the model to surface off-the-beaten-path picks.
// Used by offline LLM fallbacks when hidden-gems mode is on and we can't
// reach Wikipedia to re-rank real places.
export const HIDDEN_GEMS_DIRECTIVE =
  'Prioritize lesser-known local gems — neighborhood landmarks, unusual historical curiosities, independent spots, off-the-beaten-path places locals love. Avoid the most famous marquee attractions unless nothing else fits.';
