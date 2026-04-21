import { createPersistedStore } from './persistedStore';

// User preferences that shape how the guide speaks — narration length,
// TTS voice identity, playback rate. Persisted across app launches so
// a traveler doesn't re-tune them every session.

export type NarrationLength = 'short' | 'standard' | 'deep';

export const NARRATION_LENGTH_VALUES: NarrationLength[] = ['short', 'standard', 'deep'];

export interface NarrationPrefs {
  length: NarrationLength;
  rate: number;
  voice: string | undefined;
}

const DEFAULTS: NarrationPrefs = {
  length: 'standard',
  rate: 0.95,
  voice: undefined,
};

const MIN_RATE = 0.5;
const MAX_RATE = 2.0;

function clampRate(rate: number): number {
  return Math.max(MIN_RATE, Math.min(MAX_RATE, rate));
}

const store = createPersistedStore<NarrationPrefs>({
  storageKey: '@localguide/narration-prefs-v1',
  defaults: DEFAULTS,
  validate: (raw, defaults) => {
    if (!raw || typeof raw !== 'object') return defaults;
    const r = raw as Record<string, unknown>;
    return {
      length: NARRATION_LENGTH_VALUES.includes(r.length as NarrationLength)
        ? (r.length as NarrationLength)
        : defaults.length,
      rate: typeof r.rate === 'number' ? clampRate(r.rate) : defaults.rate,
      voice: typeof r.voice === 'string' ? r.voice : defaults.voice,
    };
  },
});

export const narrationPrefs = {
  hydrate: () => store.hydrate(),
  get: () => store.get(),
  subscribe: (listener: (p: NarrationPrefs) => void) => store.subscribe(listener),

  setLength(length: NarrationLength): void {
    store.set({ length });
  },

  setRate(rate: number): void {
    store.set({ rate: clampRate(rate) });
  },

  setVoice(voice: string | undefined): void {
    store.set({ voice });
  },

  __resetForTest(): void {
    store.__resetForTest();
  },
};

/**
 * Prompt directive describing how long the narration should be. Paired with
 * the narrator SYSTEM_PROMPT's existing "3-6 sentences" rule; Gemma follows
 * the length count more reliably than an abstract word like "short".
 */
export function narrationLengthDirective(length: NarrationLength): string {
  switch (length) {
    case 'short':
      return 'Length: 1-2 short sentences, under 25 seconds spoken.';
    case 'deep':
      return 'Length: 6-10 sentences of rich detail, about 2-3 minutes spoken. Go deeper into history and stories.';
    case 'standard':
    default:
      return 'Length: 3-5 sentences, about 45-90 seconds spoken.';
  }
}
