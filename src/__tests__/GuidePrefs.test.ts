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
});
