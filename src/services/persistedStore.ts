import AsyncStorage from '@react-native-async-storage/async-storage';

export interface PersistedStoreConfig<T> {
  storageKey: string;
  defaults: T;
  /**
   * Narrow unknown JSON into a valid T. Called with the raw parsed JSON and
   * the defaults, should return a fully populated T where any missing or
   * malformed fields have been replaced with defaults.
   *
   * Default: shallow-merge raw over defaults, only keeping properties whose
   * types match the defaults.
   */
  validate?: (raw: unknown, defaults: T) => T;
  /**
   * Coalesce persistent writes by this many ms. Useful for high-frequency
   * updates (e.g. GPS ticks on the breadcrumb trail) so every update doesn't
   * trip an AsyncStorage round-trip. 0 disables debouncing.
   */
  saveDebounceMs?: number;
}

export interface PersistedStore<T> {
  get(): T;
  set(updater: Partial<T> | ((s: T) => T)): void;
  subscribe(listener: (s: T) => void): () => void;
  hydrate(): Promise<void>;
  __resetForTest(): void;
}

function defaultValidate<T>(raw: unknown, defaults: T): T {
  if (!raw || typeof raw !== 'object') return defaults;
  const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  for (const key of Object.keys(defaults as object)) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === typeof (defaults as Record<string, unknown>)[key] && value !== null) {
      out[key] = value;
    }
  }
  return out as T;
}

/**
 * Build a module-scoped persisted store. Replaces the load/save/subscribe/
 * notify boilerplate that every preference module used to duplicate.
 *
 * Usage:
 *   const store = createPersistedStore<Shape>({ storageKey, defaults });
 *   store.hydrate();                             // call once at boot
 *   const v = store.get();
 *   store.set({ hiddenGems: true });             // partial
 *   store.set(s => ({ ...s, points: [...] }));   // updater
 *   const unsub = store.subscribe(s => ...);
 */
export function createPersistedStore<T extends object>(
  config: PersistedStoreConfig<T>
): PersistedStore<T> {
  const validate = config.validate ?? defaultValidate;
  const saveDebounceMs = config.saveDebounceMs ?? 0;

  let current: T = { ...config.defaults };
  let loaded = false;
  let loadPromise: Promise<void> | null = null;
  const listeners = new Set<(s: T) => void>();
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  function notify(): void {
    for (const l of listeners) l(current);
  }

  async function writeNow(): Promise<void> {
    try {
      await AsyncStorage.setItem(config.storageKey, JSON.stringify(current));
    } catch {
      // Non-critical: worst case preferences revert on the next launch.
    }
  }

  function scheduleSave(): void {
    if (saveDebounceMs <= 0) {
      writeNow();
      return;
    }
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      writeNow();
    }, saveDebounceMs);
  }

  async function load(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(config.storageKey);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        current = validate(parsed, config.defaults);
      }
    } catch {
      // Corrupt or unavailable storage — keep defaults.
    } finally {
      loaded = true;
    }
  }

  return {
    get() {
      return current;
    },
    set(updater) {
      const next =
        typeof updater === 'function'
          ? (updater as (s: T) => T)(current)
          : { ...current, ...updater };
      // Reference equality short-circuit: if no key actually changed, skip
      // the save + notify. Subscribers generally don't want a no-op churn.
      let changed = false;
      for (const key of Object.keys(next) as Array<keyof T>) {
        if (!Object.is(next[key], current[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      current = next;
      scheduleSave();
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hydrate() {
      if (loaded) return Promise.resolve();
      if (!loadPromise) loadPromise = load();
      return loadPromise;
    },
    __resetForTest() {
      current = { ...config.defaults };
      loaded = false;
      loadPromise = null;
      listeners.clear();
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
    },
  };
}
