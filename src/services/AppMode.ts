import type { ModeChoice } from './GuidePrefs';
import { guidePrefs } from './GuidePrefs';
import { networkStatus, type NetworkState } from './NetworkStatus';

export type { ModeChoice };
export type EffectiveMode = 'online' | 'offline';

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

export const appMode = {
  get(): EffectiveMode {
    ensureSubscribed();
    return effective;
  },

  subscribe(listener: ModeListener): () => void {
    ensureSubscribed();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  __resetForTest(): void {
    effective = 'online';
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
