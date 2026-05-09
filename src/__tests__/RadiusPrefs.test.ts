import AsyncStorage from '@react-native-async-storage/async-storage';
import { radiusPrefs } from '../services/RadiusPrefs';

describe('radiusPrefs', () => {
  beforeEach(async () => {
    radiusPrefs.__resetForTest();
    await AsyncStorage.clear();
  });

  it('defaults radiusMeters to 10000', () => {
    expect(radiusPrefs.get().radiusMeters).toBe(10000);
  });

  it('set(5000) persists + notifies subscriber', async () => {
    const listener = jest.fn();
    radiusPrefs.subscribe(listener);
    radiusPrefs.set(5000);

    expect(radiusPrefs.get().radiusMeters).toBe(5000);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ radiusMeters: 5000 }));

    // Persistence round-trip: reset and re-hydrate from storage.
    radiusPrefs.__resetForTest();
    await radiusPrefs.hydrate();
    expect(radiusPrefs.get().radiusMeters).toBe(5000);
  });

  it('does not notify when value is unchanged', () => {
    const listener = jest.fn();
    radiusPrefs.subscribe(listener);
    radiusPrefs.set(10000); // already 10000 (default)
    expect(listener).not.toHaveBeenCalled();
  });

  it('subscribe fires on set and unsubscribe stops firing', () => {
    const listener = jest.fn();
    const unsub = radiusPrefs.subscribe(listener);

    radiusPrefs.set(2000);
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    radiusPrefs.set(20000);
    expect(listener).toHaveBeenCalledTimes(1); // still 1 — no extra call after unsub
  });

  it('rejects invalid value — store stays unchanged and no notification fires', () => {
    const listener = jest.fn();
    radiusPrefs.subscribe(listener);

    radiusPrefs.set(3000 as number); // not in valid set
    expect(radiusPrefs.get().radiusMeters).toBe(10000); // unchanged default
    expect(listener).not.toHaveBeenCalled();
  });

  it('rejects old 1000 m value (removed from valid set)', () => {
    const listener = jest.fn();
    radiusPrefs.subscribe(listener);

    radiusPrefs.set(1000 as number); // was valid in old version, now removed
    expect(radiusPrefs.get().radiusMeters).toBe(10000); // unchanged default
    expect(listener).not.toHaveBeenCalled();
  });

  it('all valid values round-trip through AsyncStorage', async () => {
    for (const valid of [2000, 5000, 10000, 20000]) {
      radiusPrefs.__resetForTest();
      await AsyncStorage.clear();

      radiusPrefs.set(valid);
      radiusPrefs.__resetForTest();
      await radiusPrefs.hydrate();
      expect(radiusPrefs.get().radiusMeters).toBe(valid);
    }
  });

  it('hydrate() falls back to defaults on corrupt storage', async () => {
    await AsyncStorage.setItem('@localguide/radius-prefs-v1', 'not-json{{');
    radiusPrefs.__resetForTest();
    await radiusPrefs.hydrate();
    expect(radiusPrefs.get().radiusMeters).toBe(10000);
  });

  it('hydrate() falls back to defaults when stored radius is invalid', async () => {
    await AsyncStorage.setItem(
      '@localguide/radius-prefs-v1',
      JSON.stringify({ radiusMeters: 9999 })
    );
    radiusPrefs.__resetForTest();
    await radiusPrefs.hydrate();
    expect(radiusPrefs.get().radiusMeters).toBe(10000);
  });

  it('hydrate() migrates old 1000 m value to default 10000 m', async () => {
    // Simulate a user who had 1 km saved from the old valid set {1,2,5,10} km.
    await AsyncStorage.setItem(
      '@localguide/radius-prefs-v1',
      JSON.stringify({ radiusMeters: 1000 })
    );
    radiusPrefs.__resetForTest();
    await radiusPrefs.hydrate();
    expect(radiusPrefs.get().radiusMeters).toBe(10000);
  });
});
