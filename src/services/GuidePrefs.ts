import { createPersistedStore } from './persistedStore';

// Non-narration user preferences. Keeps NarrationPrefs focused on TTS/length
// concerns and makes room for additional UX toggles (hidden gems, exploration
// mode, etc.) without bloating that store.

export interface GuidePrefsShape {
  /**
   * When on, nearby-place lookups rank less-famous spots above the blockbuster
   * attractions, and the LLM fallback is instructed to pick offbeat locations.
   */
  hiddenGems: boolean;
  /**
   * When on, the app makes no network calls — Wikipedia geosearch, reverse
   * geocoding, etc. are all skipped and the on-device model is the only
   * source of tourist info. Default on so the app works anywhere (airplane,
   * foreign-data-roaming) without surprises.
   */
  offlineMode: boolean;
}

const DEFAULTS: GuidePrefsShape = {
  hiddenGems: false,
  offlineMode: true,
};

const store = createPersistedStore<GuidePrefsShape>({
  storageKey: '@localguide/guide-prefs-v1',
  defaults: DEFAULTS,
  validate: (raw, defaults) => {
    if (!raw || typeof raw !== 'object') return defaults;
    const obj = raw as Record<string, unknown>;
    return {
      hiddenGems: typeof obj.hiddenGems === 'boolean' ? obj.hiddenGems : defaults.hiddenGems,
      offlineMode: typeof obj.offlineMode === 'boolean' ? obj.offlineMode : defaults.offlineMode,
    };
  },
});

export const guidePrefs = {
  hydrate: () => store.hydrate(),
  get: () => store.get(),
  subscribe: (listener: (p: GuidePrefsShape) => void) => store.subscribe(listener),

  setHiddenGems(value: boolean): void {
    store.set({ hiddenGems: value });
  },

  setOfflineMode(value: boolean): void {
    store.set({ offlineMode: value });
  },

  __resetForTest(): void {
    store.__resetForTest();
  },
};

// Prompt directive asking the model to surface off-the-beaten-path picks.
// Used by offline LLM fallbacks when hidden-gems mode is on and we can't
// reach Wikipedia to re-rank real places.
export const HIDDEN_GEMS_DIRECTIVE =
  'Prioritize lesser-known local gems — neighborhood landmarks, unusual historical curiosities, independent spots, off-the-beaten-path places locals love. Avoid the most famous marquee attractions unless nothing else fits.';
