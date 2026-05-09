import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ModeChoice } from './GuidePrefs';
import { guidePrefs } from './GuidePrefs';
import { networkStatus, type NetworkState } from './NetworkStatus';

export type { ModeChoice };
export type EffectiveMode = 'online' | 'offline';

// Persisted choice key. Values: 'auto' | 'force-online' | 'force-offline'.
// Mirrors the radiusPrefs pattern: lazy hydrate on first read, persist on
// every setMode() call, default to 'auto'.
// NOTE: GuidePrefs already persists modeChoice under @localguide/guide-prefs-v1.
// This key is additive — setMode() writes to both so that any future
// consumer of the appMode module can hydrate independently if needed.
const STORAGE_KEY = '@localguide/app-mode-v1';

const VALID_CHOICES: readonly ModeChoice[] = ['auto', 'force-online', 'force-offline'];
function isValidChoice(v: unknown): v is ModeChoice {
  return VALID_CHOICES.includes(v as ModeChoice);
}

// Pure resolver: no side effects, easy to unit-test.
export function resolve(choice: ModeChoice, network: NetworkState): EffectiveMode {
  if (choice === 'force-online') return 'online';
  if (choice === 'force-offline') return 'offline';
  // 'auto': follow network. Unknown is optimistic — cold-start defaults to online.
  return network === 'offline' ? 'offline' : 'online';
}

type ModeListener = (m: EffectiveMode) => void;

let effective: EffectiveMode = resolve(guidePrefs.get().modeChoice, networkStatus.get());
const listeners = new Set<ModeListener>();
let unsubPrefs: (() => void) | null = null;
let unsubNetwork: (() => void) | null = null;

// Hydration state for the standalone key.
let hydrated = false;

function recompute(): void {
  const next = resolve(guidePrefs.get().modeChoice, networkStatus.get());
  if (next === effective) return;
  effective = next;
  for (const l of listeners) l(effective);
}

function ensureSubscribed(): void {
  if (unsubPrefs) return;
  unsubPrefs = guidePrefs.subscribe(() => recompute());
  unsubNetwork = networkStatus.subscribe(() => recompute());
}

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isValidChoice(parsed)) {
        // Only apply if the standalone key differs from whatever guidePrefs
        // already loaded — this avoids regressing a freshly-loaded guidePrefs.
        guidePrefs.setModeChoice(parsed);
      }
    }
  } catch {
    // Non-critical: keep defaults.
  }
}

async function persistChoice(choice: ModeChoice): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // Non-critical.
  }
}

export const appMode = {
  get(): EffectiveMode {
    ensureSubscribed();
    return effective;
  },

  /** Persist and apply a user-facing mode choice ('auto' | 'force-online' | 'force-offline'). */
  setMode(choice: ModeChoice): void {
    if (!isValidChoice(choice)) return;
    guidePrefs.setModeChoice(choice);
    persistChoice(choice);
    // recompute() is called automatically via the guidePrefs subscription.
  },

  /** Lazy hydrate from AsyncStorage. Call once at boot. */
  hydrate,

  subscribe(listener: ModeListener): () => void {
    ensureSubscribed();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  __resetForTest(): void {
    effective = 'online';
    hydrated = false;
    listeners.clear();
    if (unsubPrefs) {
      unsubPrefs();
      unsubPrefs = null;
    }
    if (unsubNetwork) {
      unsubNetwork();
      unsubNetwork = null;
    }
  },
};

// Kick off hydration at module load so persisted choice is in effect before
// the first render — mirrors guidePrefs and radiusPrefs boot patterns.
appMode.hydrate().catch(() => {});

// Subscribe to the underlying sources at module load (rather than lazily on
// first appMode.get()/subscribe()). Without this, NetworkStatus.init's
// AsyncStorage seed — which fires `transition('offline')` asynchronously —
// can land before any consumer has registered a subscriber, the notify is
// dropped, and `effective` stays stuck at the optimistic 'online' it was
// computed at module load.
ensureSubscribed();
