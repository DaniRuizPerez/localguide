/**
 * C3 — background narration wake-lock. Verifies the keeper toggles
 * expo-keep-awake in lockstep with SpeechService state.
 */

const mockActivate = jest.fn().mockResolvedValue(undefined);
const mockDeactivate = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: (...args: unknown[]) => mockActivate(...args),
  deactivateKeepAwake: (...args: unknown[]) => mockDeactivate(...args),
}));

jest.mock('expo-speech', () => ({
  speak: jest.fn(),
  stop: jest.fn(),
  isSpeakingAsync: jest.fn().mockResolvedValue(false),
}));

describe('SpeechBackgroundKeeper', () => {
  let speechService: typeof import('../services/SpeechService').speechService;
  let speechBackgroundKeeper: typeof import('../services/SpeechBackgroundKeeper').speechBackgroundKeeper;

  beforeEach(() => {
    jest.resetModules();
    mockActivate.mockClear();
    mockDeactivate.mockClear();
    const narrationPrefs = require('../services/NarrationPrefs').narrationPrefs;
    narrationPrefs.__resetForTest();
    speechService = require('../services/SpeechService').speechService;
    speechBackgroundKeeper = require('../services/SpeechBackgroundKeeper').speechBackgroundKeeper;
    speechBackgroundKeeper.__resetForTest();
  });

  it('install() holds the wake-lock while narration is active', () => {
    speechBackgroundKeeper.install();
    expect(mockActivate).not.toHaveBeenCalled();

    speechService.enqueue('Narration starting.');
    expect(mockActivate).toHaveBeenCalledWith('localguide-speech');
  });

  it('releases the wake-lock when the queue drains', () => {
    speechBackgroundKeeper.install();
    speechService.enqueue('First sentence.');
    expect(mockActivate).toHaveBeenCalledTimes(1);

    // Simulate expo-speech finishing the sentence
    const expoSpeech = require('expo-speech');
    const call = expoSpeech.speak.mock.calls[expoSpeech.speak.mock.calls.length - 1];
    call?.[1]?.onDone?.();

    expect(mockDeactivate).toHaveBeenCalledWith('localguide-speech');
  });

  it('keeps the wake-lock while paused (user may resume)', () => {
    speechBackgroundKeeper.install();
    speechService.enqueue('Pause me.');
    expect(mockActivate).toHaveBeenCalledTimes(1);

    speechService.pause();
    const expoSpeech = require('expo-speech');
    const call = expoSpeech.speak.mock.calls[expoSpeech.speak.mock.calls.length - 1];
    call?.[1]?.onStopped?.();

    // Still held while paused — a paused narration is still "in flight".
    expect(mockDeactivate).not.toHaveBeenCalled();
  });

  it('re-install() does not double-register', () => {
    speechBackgroundKeeper.install();
    speechBackgroundKeeper.install();
    speechService.enqueue('Only once.');
    expect(mockActivate).toHaveBeenCalledTimes(1);
  });

  it('uninstall() drops the subscription and releases an active lock', () => {
    const unsub = speechBackgroundKeeper.install();
    speechService.enqueue('Background me.');
    expect(speechBackgroundKeeper.__isActiveForTest()).toBe(true);

    unsub();
    expect(mockDeactivate).toHaveBeenCalledWith('localguide-speech');
    expect(speechBackgroundKeeper.__isActiveForTest()).toBe(false);
  });

  it('swallows keep-awake failures without breaking narration', async () => {
    mockActivate.mockRejectedValueOnce(new Error('wake-lock denied'));
    speechBackgroundKeeper.install();
    speechService.enqueue('Anyway.');
    // Resolve microtask so the rejected promise settles
    await Promise.resolve();
    await Promise.resolve();
    expect(speechService.isSpeaking).toBe(true);
  });
});
