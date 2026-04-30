import AsyncStorage from '@react-native-async-storage/async-storage';
import { visitedStore } from '../services/VisitedStore';

describe('visitedStore', () => {
  beforeEach(async () => {
    visitedStore.__resetForTest();
    await AsyncStorage.clear();
  });

  it('defaults to empty', () => {
    expect(visitedStore.get().titles).toEqual({});
    expect(visitedStore.isVisited('Eiffel Tower')).toBe(false);
  });

  it('setVisited(true) marks the title and notifies subscribers', () => {
    const listener = jest.fn();
    visitedStore.subscribe(listener);
    visitedStore.setVisited('Eiffel Tower', true);

    expect(visitedStore.isVisited('Eiffel Tower')).toBe(true);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ titles: { 'eiffel tower': true } })
    );
  });

  it('lookup is case- and whitespace-insensitive', () => {
    visitedStore.setVisited('  Eiffel Tower ', true);
    expect(visitedStore.isVisited('eiffel tower')).toBe(true);
    expect(visitedStore.isVisited('EIFFEL TOWER')).toBe(true);
  });

  it('setVisited(false) clears the title', () => {
    visitedStore.setVisited('Louvre', true);
    visitedStore.setVisited('Louvre', false);
    expect(visitedStore.isVisited('Louvre')).toBe(false);
    expect(visitedStore.get().titles).toEqual({});
  });

  it('does not notify when value is unchanged', () => {
    visitedStore.setVisited('Louvre', true);
    const listener = jest.fn();
    visitedStore.subscribe(listener);
    visitedStore.setVisited('Louvre', true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('ignores empty / whitespace titles', () => {
    visitedStore.setVisited('   ', true);
    expect(visitedStore.get().titles).toEqual({});
  });

  it('persists across hydrate', async () => {
    visitedStore.setVisited('Eiffel Tower', true);
    visitedStore.setVisited('Louvre', true);
    await new Promise((r) => setImmediate(r));

    visitedStore.__resetForTest();
    await visitedStore.hydrate();

    expect(visitedStore.isVisited('Eiffel Tower')).toBe(true);
    expect(visitedStore.isVisited('Louvre')).toBe(true);
  });

  it('hydrate falls back to defaults on corrupt storage', async () => {
    await AsyncStorage.setItem('@localguide/visited-v1', 'not-json{{');
    visitedStore.__resetForTest();
    await visitedStore.hydrate();
    expect(visitedStore.get().titles).toEqual({});
  });

  it('hydrate skips non-true values from a tampered payload', async () => {
    await AsyncStorage.setItem(
      '@localguide/visited-v1',
      JSON.stringify({ titles: { 'eiffel tower': true, louvre: 'maybe', colosseum: 1 } })
    );
    visitedStore.__resetForTest();
    await visitedStore.hydrate();
    expect(visitedStore.get().titles).toEqual({ 'eiffel tower': true });
  });
});
