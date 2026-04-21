/**
 * Tests for the generic createPersistedStore factory that underpins
 * NarrationPrefs, GuidePrefs, and BreadcrumbTrail.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createPersistedStore } from '../services/persistedStore';

interface Shape {
  flag: boolean;
  count: number;
}

describe('createPersistedStore', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('starts with defaults before hydrate', () => {
    const store = createPersistedStore<Shape>({
      storageKey: 'test-1',
      defaults: { flag: false, count: 0 },
    });
    expect(store.get()).toEqual({ flag: false, count: 0 });
  });

  it('partial set merges into current state', () => {
    const store = createPersistedStore<Shape>({
      storageKey: 'test-2',
      defaults: { flag: false, count: 0 },
    });
    store.set({ flag: true });
    expect(store.get()).toEqual({ flag: true, count: 0 });
  });

  it('functional set receives previous state', () => {
    const store = createPersistedStore<Shape>({
      storageKey: 'test-3',
      defaults: { flag: false, count: 0 },
    });
    store.set((s) => ({ ...s, count: s.count + 1 }));
    store.set((s) => ({ ...s, count: s.count + 1 }));
    expect(store.get().count).toBe(2);
  });

  it('no-op set does not notify subscribers', () => {
    const store = createPersistedStore<Shape>({
      storageKey: 'test-4',
      defaults: { flag: false, count: 0 },
    });
    const listener = jest.fn();
    store.subscribe(listener);
    store.set({ flag: false }); // same value
    expect(listener).not.toHaveBeenCalled();
  });

  it('persists across hydrate — default validator preserves matching types', async () => {
    const a = createPersistedStore<Shape>({
      storageKey: 'test-5',
      defaults: { flag: false, count: 0 },
    });
    a.set({ flag: true, count: 42 });
    // With saveDebounceMs unset, writes go through immediately.
    await new Promise((r) => setImmediate(r));

    const b = createPersistedStore<Shape>({
      storageKey: 'test-5',
      defaults: { flag: false, count: 0 },
    });
    await b.hydrate();
    expect(b.get()).toEqual({ flag: true, count: 42 });
  });

  it('custom validator receives raw + defaults', async () => {
    const validate = jest.fn((raw: unknown, defaults: Shape) => {
      if (raw && typeof raw === 'object' && 'flag' in raw) {
        return { flag: Boolean((raw as { flag: unknown }).flag), count: defaults.count };
      }
      return defaults;
    });
    await AsyncStorage.setItem('test-6', JSON.stringify({ flag: 'yes', count: 'whoops' }));

    const store = createPersistedStore<Shape>({
      storageKey: 'test-6',
      defaults: { flag: false, count: 0 },
      validate,
    });
    await store.hydrate();
    expect(validate).toHaveBeenCalled();
    expect(store.get()).toEqual({ flag: true, count: 0 });
  });

  it('corrupt storage falls back to defaults', async () => {
    await AsyncStorage.setItem('test-7', 'not-json{{{{');
    const store = createPersistedStore<Shape>({
      storageKey: 'test-7',
      defaults: { flag: false, count: 0 },
    });
    await store.hydrate();
    expect(store.get()).toEqual({ flag: false, count: 0 });
  });

  it('subscribe returns an unsubscribe function', () => {
    const store = createPersistedStore<Shape>({
      storageKey: 'test-8',
      defaults: { flag: false, count: 0 },
    });
    const listener = jest.fn();
    const unsub = store.subscribe(listener);
    store.set({ count: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    store.set({ count: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('debouncing coalesces rapid-fire writes', async () => {
    jest.useFakeTimers();
    try {
      const setSpy = jest.spyOn(AsyncStorage, 'setItem');
      setSpy.mockClear();
      const store = createPersistedStore<Shape>({
        storageKey: 'test-9',
        defaults: { flag: false, count: 0 },
        saveDebounceMs: 50,
      });
      store.set({ count: 1 });
      store.set({ count: 2 });
      store.set({ count: 3 });
      expect(setSpy).not.toHaveBeenCalled();

      jest.advanceTimersByTime(60);
      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0][1]).toContain('"count":3');
      setSpy.mockRestore();
      store.__resetForTest();
    } finally {
      jest.useRealTimers();
    }
  });

  it('__resetForTest clears state + listeners', () => {
    const store = createPersistedStore<Shape>({
      storageKey: 'test-10',
      defaults: { flag: false, count: 0 },
    });
    store.set({ count: 1 });
    const listener = jest.fn();
    store.subscribe(listener);
    store.__resetForTest();
    expect(store.get()).toEqual({ flag: false, count: 0 });

    store.set({ count: 1 });
    expect(listener).not.toHaveBeenCalled();
  });
});
