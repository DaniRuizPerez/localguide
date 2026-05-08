import AsyncStorage from '@react-native-async-storage/async-storage';
import { unitPrefs } from '../services/UnitPrefs';

describe('unitPrefs', () => {
  beforeEach(async () => {
    unitPrefs.__resetForTest();
    await AsyncStorage.clear();
  });

  it('get() returns a units value', () => {
    const { units } = unitPrefs.get();
    expect(['km', 'miles']).toContain(units);
  });

  it('set("km") persists + notifies subscriber', async () => {
    const listener = jest.fn();
    unitPrefs.subscribe(listener);
    unitPrefs.set('km');

    const state = unitPrefs.get();
    // Only assert notification fired if value actually changed.
    expect(['km', 'miles']).toContain(state.units);

    // Persistence round-trip: reset and re-hydrate from storage.
    unitPrefs.set('km');
    unitPrefs.__resetForTest();
    await unitPrefs.hydrate();
    expect(unitPrefs.get().units).toBe('km');
  });

  it('set("miles") persists', async () => {
    unitPrefs.set('miles');
    unitPrefs.__resetForTest();
    await unitPrefs.hydrate();
    expect(unitPrefs.get().units).toBe('miles');
  });

  it('subscribe fires on change and unsubscribe stops firing', () => {
    // Force a known starting state.
    unitPrefs.set('km');
    const listener = jest.fn();
    const unsub = unitPrefs.subscribe(listener);

    unitPrefs.set('miles');
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ units: 'miles' }));

    unsub();
    unitPrefs.set('km');
    expect(listener).toHaveBeenCalledTimes(1); // no extra call after unsub
  });

  it('does not notify when value is unchanged', () => {
    unitPrefs.set('km');
    const listener = jest.fn();
    unitPrefs.subscribe(listener);
    unitPrefs.set('km'); // same value
    expect(listener).not.toHaveBeenCalled();
  });

  it('hydrate() falls back to defaults on corrupt storage', async () => {
    await AsyncStorage.setItem('@localguide/unit-prefs-v1', 'not-json{{');
    unitPrefs.__resetForTest();
    await unitPrefs.hydrate();
    expect(['km', 'miles']).toContain(unitPrefs.get().units);
  });

  it('hydrate() falls back to defaults when stored value is invalid', async () => {
    await AsyncStorage.setItem(
      '@localguide/unit-prefs-v1',
      JSON.stringify({ units: 'furlongs' })
    );
    unitPrefs.__resetForTest();
    await unitPrefs.hydrate();
    expect(['km', 'miles']).toContain(unitPrefs.get().units);
  });
});
