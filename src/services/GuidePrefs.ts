import { createPersistedStore } from './persistedStore';

// Non-narration user preferences. Keeps NarrationPrefs focused on TTS/length
// concerns and makes room for additional UX toggles (hidden gems, exploration
// mode, etc.) without bloating that store.

export type ModeChoice = 'auto' | 'force-online' | 'force-offline';

const VALID_MODE_CHOICES: readonly ModeChoice[] = ['auto', 'force-online', 'force-offline'];

export interface GuidePrefsShape {
  /**
   * When on, nearby-place lookups rank less-famous spots above the blockbuster
   * attractions, and the LLM fallback is instructed to pick offbeat locations.
   */
  hiddenGems: boolean;
  /**
   * Connectivity policy. 'auto' = follow NetworkStatus; 'force-online' /
   * 'force-offline' = override regardless of actual network state.
   * Replaces the legacy boolean offlineMode field.
   */
  modeChoice: ModeChoice;
  /**
   * When on, useLocation prefers the bundled cities15000 + per-country
   * GeoNames packs (via GeoModule) for reverse-geocoding before falling back
   * to expo-location's platform geocoder. Default on so users with the
   * native module installed get offline place names everywhere; if the
   * native module isn't registered the toggle is effectively a no-op.
   */
  useOfflineGeocoder: boolean;
}

// View type returned from get() and passed to subscribers. Carries the shim
// offlineMode getter so existing callers compile without modification.
// Shimmed for the duration of the rollout; Wave 2 packages migrate to AppMode.
export type GuidePrefsView = GuidePrefsShape & {
  /** @deprecated Use appMode.get() or GuidePrefsShape.modeChoice instead. */
  readonly offlineMode: boolean;
};

const DEFAULTS: GuidePrefsShape = {
  hiddenGems: false,
  // Fresh install is 'auto' — network decides, optimistically online.
  modeChoice: 'auto',
  useOfflineGeocoder: true,
};

function isModeChoice(v: unknown): v is ModeChoice {
  return VALID_MODE_CHOICES.includes(v as ModeChoice);
}

const store = createPersistedStore<GuidePrefsShape>({
  storageKey: '@localguide/guide-prefs-v1',
  defaults: DEFAULTS,
  validate: (raw, defaults) => {
    if (!raw || typeof raw !== 'object') return defaults;
    const obj = raw as Record<string, unknown>;

    // Migrate legacy boolean offlineMode → modeChoice.
    let modeChoice: ModeChoice;
    if (isModeChoice(obj.modeChoice)) {
      modeChoice = obj.modeChoice;
    } else if (obj.offlineMode === true) {
      modeChoice = 'force-offline';
    } else if (obj.offlineMode === false) {
      modeChoice = 'auto';
    } else {
      modeChoice = defaults.modeChoice;
    }

    return {
      hiddenGems: typeof obj.hiddenGems === 'boolean' ? obj.hiddenGems : defaults.hiddenGems,
      modeChoice,
      useOfflineGeocoder:
        typeof obj.useOfflineGeocoder === 'boolean'
          ? obj.useOfflineGeocoder
          : defaults.useOfflineGeocoder,
    };
  },
});

function toView(shape: GuidePrefsShape): GuidePrefsView {
  return Object.defineProperty(
    { ...shape } as GuidePrefsShape & { offlineMode: boolean },
    'offlineMode',
    { get() { return shape.modeChoice === 'force-offline'; }, enumerable: true, configurable: true }
  ) as GuidePrefsView;
}

export const guidePrefs = {
  hydrate: () => store.hydrate(),

  get(): GuidePrefsView {
    return toView(store.get());
  },

  subscribe(listener: (p: GuidePrefsView) => void): () => void {
    return store.subscribe((shape) => listener(toView(shape)));
  },

  setHiddenGems(value: boolean): void {
    store.set({ hiddenGems: value });
  },

  setModeChoice(value: ModeChoice): void {
    store.set({ modeChoice: value });
  },

  setUseOfflineGeocoder(value: boolean): void {
    store.set({ useOfflineGeocoder: value });
  },

  // Shimmed for the duration of the rollout. Callers being migrated to AppMode.
  get offlineMode(): boolean {
    return store.get().modeChoice === 'force-offline';
  },
  setOfflineMode(value: boolean): void {
    this.setModeChoice(value ? 'force-offline' : 'auto');
  },

  __resetForTest(): void {
    store.__resetForTest();
  },
};

// Kick off hydration at module load so the persisted modeChoice (and hidden-
// gems toggle, geocoder pref) are in effect as early as the React tree's
// first render. Subscribers — AppMode → useAppMode → ConnectionPill /
// ChatScreen ranker — get notified when load completes. Without this, every
// app boot starts at modeChoice='auto' regardless of what the user picked
// last session, and the persisted force-offline state silently regresses.
guidePrefs.hydrate().catch(() => {});

// Prompt directive asking the model to surface off-the-beaten-path picks.
// Used by offline LLM fallbacks when hidden-gems mode is on and we can't
// reach Wikipedia to re-rank real places.
export const HIDDEN_GEMS_DIRECTIVE =
  'Prioritize lesser-known local gems — neighborhood landmarks, unusual historical curiosities, independent spots, off-the-beaten-path places locals love. Avoid the most famous marquee attractions unless nothing else fits.';
