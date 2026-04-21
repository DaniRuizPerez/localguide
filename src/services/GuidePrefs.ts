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
}

const DEFAULTS: GuidePrefsShape = {
  hiddenGems: false,
};

const store = createPersistedStore<GuidePrefsShape>({
  storageKey: '@localguide/guide-prefs-v1',
  defaults: DEFAULTS,
  validate: (raw, defaults) => {
    if (!raw || typeof raw !== 'object') return defaults;
    const hiddenGems = (raw as Record<string, unknown>).hiddenGems;
    return {
      hiddenGems: typeof hiddenGems === 'boolean' ? hiddenGems : defaults.hiddenGems,
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

  __resetForTest(): void {
    store.__resetForTest();
  },
};

// Prompt directive asking the model to surface off-the-beaten-path picks.
// Used by offline LLM fallbacks when hidden-gems mode is on and we can't
// reach Wikipedia to re-rank real places.
export const HIDDEN_GEMS_DIRECTIVE =
  'Prioritize lesser-known local gems — neighborhood landmarks, unusual historical curiosities, independent spots, off-the-beaten-path places locals love. Avoid the most famous marquee attractions unless nothing else fits.';
