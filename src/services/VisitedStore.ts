import { createPersistedStore } from './persistedStore';

// Tracks which POI titles the user has marked as visited from the
// Plan-My-Day sheet. Lookups are by lowercased title since the same place
// can appear with slightly different casing across LLM calls; the user's
// intent is "this place is done", not "this exact string is done".

export interface VisitedShape {
  // Lowercased title -> true. Plain object instead of Set so it serialises
  // cleanly through JSON.parse on reload.
  titles: Record<string, true>;
}

const DEFAULTS: VisitedShape = { titles: {} };

const store = createPersistedStore<VisitedShape>({
  storageKey: '@localguide/visited-v1',
  defaults: DEFAULTS,
  validate: (raw, defaults) => {
    if (!raw || typeof raw !== 'object') return defaults;
    const obj = (raw as Record<string, unknown>).titles;
    if (!obj || typeof obj !== 'object') return defaults;
    const titles: Record<string, true> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof k === 'string' && v === true) titles[k.toLowerCase()] = true;
    }
    return { titles };
  },
});

function key(title: string): string {
  return title.trim().toLowerCase();
}

export const visitedStore = {
  hydrate: () => store.hydrate(),
  get: () => store.get(),
  subscribe: (listener: (s: VisitedShape) => void) => store.subscribe(listener),

  isVisited(title: string): boolean {
    return store.get().titles[key(title)] === true;
  },

  setVisited(title: string, visited: boolean): void {
    const k = key(title);
    if (!k) return;
    const cur = store.get().titles;
    if (visited && cur[k]) return;
    if (!visited && !cur[k]) return;
    const next = { ...cur };
    if (visited) next[k] = true;
    else delete next[k];
    store.set({ titles: next });
  },

  __resetForTest(): void {
    store.__resetForTest();
  },
};
