import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  narrationPrefs,
  narrationLengthDirective,
  type NarrationLength,
} from '../services/NarrationPrefs';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
  },
}));

const mockedStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

describe('narrationPrefs', () => {
  beforeEach(() => {
    narrationPrefs.__resetForTest();
    mockedStorage.getItem.mockReset();
    mockedStorage.setItem.mockReset();
    mockedStorage.getItem.mockResolvedValue(null);
    mockedStorage.setItem.mockResolvedValue(undefined);
  });

  it('defaults to standard length, rate 0.95, no voice', () => {
    const prefs = narrationPrefs.get();
    expect(prefs.length).toBe('standard');
    expect(prefs.rate).toBeCloseTo(0.95);
    expect(prefs.voice).toBeUndefined();
  });

  it('hydrate() restores a previously saved pref set', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({ length: 'deep', rate: 1.2, voice: 'es-es-x-eef-local' })
    );
    await narrationPrefs.hydrate();
    expect(narrationPrefs.get()).toEqual({
      length: 'deep',
      rate: 1.2,
      voice: 'es-es-x-eef-local',
    });
  });

  it('hydrate() falls back to defaults when storage has junk', async () => {
    mockedStorage.getItem.mockResolvedValueOnce('not-json{{');
    await narrationPrefs.hydrate();
    expect(narrationPrefs.get().length).toBe('standard');
  });

  it('clamps rate to 0.5..2.0', () => {
    narrationPrefs.setRate(0.1);
    expect(narrationPrefs.get().rate).toBe(0.5);
    narrationPrefs.setRate(10);
    expect(narrationPrefs.get().rate).toBe(2.0);
  });

  it('setLength persists through AsyncStorage.setItem', () => {
    narrationPrefs.setLength('short');
    expect(mockedStorage.setItem).toHaveBeenCalledWith(
      '@localguide/narration-prefs-v1',
      expect.stringContaining('"length":"short"')
    );
  });

  it('notifies subscribers when length changes', () => {
    const listener = jest.fn();
    const unsub = narrationPrefs.subscribe(listener);
    narrationPrefs.setLength('deep');
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ length: 'deep' }));
    unsub();
    narrationPrefs.setLength('short');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify when the new value matches the old', () => {
    const listener = jest.fn();
    narrationPrefs.subscribe(listener);
    narrationPrefs.setLength('standard'); // already the default
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('narrationLengthDirective', () => {
  const cases: Array<[NarrationLength, RegExp]> = [
    ['short', /1-2/],
    ['standard', /3-5/],
    ['deep', /6-10/],
  ];
  for (const [length, match] of cases) {
    it(`emits a sensible directive for ${length}`, () => {
      expect(narrationLengthDirective(length)).toMatch(match);
    });
  }
});
