import AsyncStorage from '@react-native-async-storage/async-storage';
import { guidePrefs } from '../services/GuidePrefs';

describe('guidePrefs', () => {
  beforeEach(async () => {
    guidePrefs.__resetForTest();
    // AsyncStorage is mocked globally — clear any prior-test state.
    await AsyncStorage.clear();
  });

  it('defaults hiddenGems to false', () => {
    expect(guidePrefs.get().hiddenGems).toBe(false);
  });

  it('setHiddenGems(true) persists + notifies', async () => {
    const listener = jest.fn();
    guidePrefs.subscribe(listener);
    guidePrefs.setHiddenGems(true);

    expect(guidePrefs.get().hiddenGems).toBe(true);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ hiddenGems: true }));

    // Persistence: re-hydrate a fresh instance and confirm it reads back true.
    guidePrefs.__resetForTest();
    await guidePrefs.hydrate();
    expect(guidePrefs.get().hiddenGems).toBe(true);
  });

  it('does not notify when value is unchanged', () => {
    const listener = jest.fn();
    guidePrefs.subscribe(listener);
    guidePrefs.setHiddenGems(false); // already false
    expect(listener).not.toHaveBeenCalled();
  });

  it('hydrate() falls back to defaults on corrupt storage', async () => {
    await AsyncStorage.setItem('@localguide/guide-prefs-v1', 'not-json{{');
    guidePrefs.__resetForTest();
    await guidePrefs.hydrate();
    expect(guidePrefs.get().hiddenGems).toBe(false);
  });

  // --- modeChoice / migration tests ---

  it('fresh install (no persisted state) → modeChoice defaults to auto', () => {
    expect(guidePrefs.get().modeChoice).toBe('auto');
  });

  it('migration: legacy {offlineMode:true} → modeChoice: force-offline', async () => {
    await AsyncStorage.setItem(
      '@localguide/guide-prefs-v1',
      JSON.stringify({ hiddenGems: false, offlineMode: true, useOfflineGeocoder: true })
    );
    guidePrefs.__resetForTest();
    await guidePrefs.hydrate();
    expect(guidePrefs.get().modeChoice).toBe('force-offline');
  });

  it('migration: legacy {offlineMode:false} → modeChoice: auto', async () => {
    await AsyncStorage.setItem(
      '@localguide/guide-prefs-v1',
      JSON.stringify({ hiddenGems: false, offlineMode: false, useOfflineGeocoder: true })
    );
    guidePrefs.__resetForTest();
    await guidePrefs.hydrate();
    expect(guidePrefs.get().modeChoice).toBe('auto');
  });

  it('new shape {modeChoice: force-online} round-trips', async () => {
    guidePrefs.setModeChoice('force-online');
    guidePrefs.__resetForTest();
    await guidePrefs.hydrate();
    expect(guidePrefs.get().modeChoice).toBe('force-online');
  });

  // --- shim tests ---

  it('shim: setOfflineMode(true) → modeChoice === force-offline', () => {
    guidePrefs.setOfflineMode(true);
    expect(guidePrefs.get().modeChoice).toBe('force-offline');
  });

  it('shim: setOfflineMode(false) → modeChoice === auto', () => {
    guidePrefs.setOfflineMode(true);
    guidePrefs.setOfflineMode(false);
    expect(guidePrefs.get().modeChoice).toBe('auto');
  });

  it('shim: offlineMode getter reflects modeChoice', () => {
    guidePrefs.setModeChoice('force-offline');
    expect(guidePrefs.offlineMode).toBe(true);
    guidePrefs.setModeChoice('auto');
    expect(guidePrefs.offlineMode).toBe(false);
    guidePrefs.setModeChoice('force-online');
    expect(guidePrefs.offlineMode).toBe(false);
  });

  it('shim: get().offlineMode reflects modeChoice via view', () => {
    guidePrefs.setModeChoice('force-offline');
    expect(guidePrefs.get().offlineMode).toBe(true);
    guidePrefs.setModeChoice('auto');
    expect(guidePrefs.get().offlineMode).toBe(false);
  });

  it('subscriber receives offlineMode in the view', () => {
    const listener = jest.fn();
    guidePrefs.subscribe(listener);
    guidePrefs.setModeChoice('force-offline');
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ modeChoice: 'force-offline', offlineMode: true })
    );
  });
});
