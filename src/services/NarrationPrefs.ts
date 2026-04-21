import AsyncStorage from '@react-native-async-storage/async-storage';

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

const STORAGE_KEY = '@localguide/narration-prefs-v1';

const DEFAULTS: NarrationPrefs = {
  length: 'standard',
  rate: 0.95,
  voice: undefined,
};

let current: NarrationPrefs = { ...DEFAULTS };
let loaded = false;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<(prefs: NarrationPrefs) => void>();

async function load(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      current = {
        length: NARRATION_LENGTH_VALUES.includes(parsed.length) ? parsed.length : DEFAULTS.length,
        rate: typeof parsed.rate === 'number' ? Math.max(0.5, Math.min(2.0, parsed.rate)) : DEFAULTS.rate,
        voice: typeof parsed.voice === 'string' ? parsed.voice : DEFAULTS.voice,
      };
    }
  } catch {
    // Corrupt or unavailable storage — fall back to defaults.
  } finally {
    loaded = true;
  }
}

async function save(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Swallow — preference loss on next launch is a non-critical degradation.
  }
}

function notify(): void {
  for (const l of listeners) l(current);
}

export const narrationPrefs = {
  /** Kick off load from storage. Safe to call multiple times. */
  hydrate(): Promise<void> {
    if (loaded) return Promise.resolve();
    if (!loadPromise) loadPromise = load();
    return loadPromise;
  },

  get(): NarrationPrefs {
    return current;
  },

  setLength(length: NarrationLength): void {
    if (current.length === length) return;
    current = { ...current, length };
    save();
    notify();
  },

  setRate(rate: number): void {
    const clamped = Math.max(0.5, Math.min(2.0, rate));
    if (current.rate === clamped) return;
    current = { ...current, rate: clamped };
    save();
    notify();
  },

  setVoice(voice: string | undefined): void {
    if (current.voice === voice) return;
    current = { ...current, voice };
    save();
    notify();
  },

  /** Subscribe to changes; returns unsubscribe. */
  subscribe(listener: (prefs: NarrationPrefs) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  // Test hook — never called from production code.
  __resetForTest(): void {
    current = { ...DEFAULTS };
    loaded = false;
    loadPromise = null;
    listeners.clear();
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
