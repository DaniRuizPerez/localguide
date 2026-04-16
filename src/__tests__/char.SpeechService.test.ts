/**
 * Characterization: SpeechService
 *
 * Locks in current behavior — including the cancellation-token fix from PR 1.
 *
 * The three "CURRENT BEHAVIOR (pre-fix)" tests from PR 0 have been updated
 * to reflect the fixed cancellation-token behavior (PR 1 intentional change):
 *   - stale onStopped/onDone callbacks are now ignored via token check
 *   - isSpeaking stays true while the second utterance is playing
 */

import * as Speech from 'expo-speech';

// ── Mock expo-speech ───────────────────────────────────────────────────────
const mockSpeak = jest.fn();
const mockStop = jest.fn();

jest.mock('expo-speech', () => ({
  speak: (...args: unknown[]) => mockSpeak(...args),
  stop: (...args: unknown[]) => mockStop(...args),
  isSpeakingAsync: jest.fn().mockResolvedValue(false),
}));

// Helper: simulate expo-speech calling a callback
function triggerSpeechCallback(callIndex: number, cbName: 'onDone' | 'onError' | 'onStopped', arg?: unknown) {
  const options = mockSpeak.mock.calls[callIndex]?.[1];
  if (!options) throw new Error(`No speech call at index ${callIndex}`);
  options[cbName]?.(arg);
}

describe('Characterization: SpeechService — basic behavior', () => {
  let speechService: typeof import('../services/SpeechService').speechService;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('expo-speech', () => ({
      speak: (...args: unknown[]) => mockSpeak(...args),
      stop: (...args: unknown[]) => mockStop(...args),
      isSpeakingAsync: jest.fn().mockResolvedValue(false),
    }));
    mockSpeak.mockClear();
    mockStop.mockClear();
    speechService = require('../services/SpeechService').speechService;
  });

  it('calls Speech.speak with the provided text', () => {
    const p = speechService.speak('Hello world');
    expect(mockSpeak).toHaveBeenCalledTimes(1);
    expect(mockSpeak.mock.calls[0][0]).toBe('Hello world');
    // Resolve to avoid open promise
    triggerSpeechCallback(0, 'onDone');
    return p;
  });

  it('passes language en-US and rate 0.95 to Speech.speak', () => {
    speechService.speak('test');
    const options = mockSpeak.mock.calls[0][1];
    expect(options.language).toBe('en-US');
    expect(options.rate).toBe(0.95);
    triggerSpeechCallback(0, 'onDone');
  });

  it('resolves the returned promise when onDone fires', async () => {
    const p = speechService.speak('done test');
    triggerSpeechCallback(0, 'onDone');
    await expect(p).resolves.toBeUndefined();
  });

  it('resolves the returned promise when onStopped fires', async () => {
    const p = speechService.speak('stopped test');
    triggerSpeechCallback(0, 'onStopped');
    await expect(p).resolves.toBeUndefined();
  });

  it('rejects the returned promise when onError fires', async () => {
    const p = speechService.speak('error test');
    triggerSpeechCallback(0, 'onError', new Error('tts error'));
    await expect(p).rejects.toThrow('tts error');
  });

  it('isSpeaking is false before speak() is called', () => {
    expect(speechService.isSpeaking).toBe(false);
  });

  it('isSpeaking is true immediately after speak() is called', () => {
    speechService.speak('check speaking flag');
    expect(speechService.isSpeaking).toBe(true);
    triggerSpeechCallback(0, 'onDone');
  });

  it('isSpeaking returns to false after onDone', () => {
    speechService.speak('check false after done');
    triggerSpeechCallback(0, 'onDone');
    expect(speechService.isSpeaking).toBe(false);
  });

  it('stop() calls Speech.stop and sets isSpeaking to false', () => {
    speechService.speak('speaking');
    expect(speechService.isSpeaking).toBe(true);
    speechService.stop();
    expect(mockStop).toHaveBeenCalled();
    expect(speechService.isSpeaking).toBe(false);
    triggerSpeechCallback(0, 'onStopped');
  });
});

describe('Characterization: SpeechService — concurrent speak() (post-fix)', () => {
  let speechService: typeof import('../services/SpeechService').speechService;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('expo-speech', () => ({
      speak: (...args: unknown[]) => mockSpeak(...args),
      stop: (...args: unknown[]) => mockStop(...args),
      isSpeakingAsync: jest.fn().mockResolvedValue(false),
    }));
    mockSpeak.mockClear();
    mockStop.mockClear();
    speechService = require('../services/SpeechService').speechService;
  });

  /**
   * PR 1 fix (was: "CURRENT BEHAVIOR: second speak() calls Speech.stop() then starts new utterance"):
   * The stop+speak sequence is unchanged. What changed: the first call's onStopped
   * is now a no-op because the cancellation token no longer matches, so isSpeaking
   * stays true while the second utterance is playing.
   */
  it('second speak() stops the first utterance and starts a new one', () => {
    speechService.speak('first');
    speechService.speak('second');

    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(mockSpeak).toHaveBeenCalledTimes(2);
    expect(mockSpeak.mock.calls[1][0]).toBe('second');

    // Stale onStopped is a no-op; isSpeaking stays true while second plays
    triggerSpeechCallback(0, 'onStopped');
    expect(speechService.isSpeaking).toBe(true);

    triggerSpeechCallback(1, 'onDone');
  });

  /**
   * PR 1 fix (was: "CURRENT BEHAVIOR: isSpeaking remains true between the two speak() calls"):
   * isSpeaking is true throughout both calls and remains true after the stale
   * onStopped fires (cancellation token prevents the flag being cleared).
   */
  it('isSpeaking is true throughout both speak() calls and after stale onStopped', () => {
    speechService.speak('first');
    expect(speechService.isSpeaking).toBe(true);

    speechService.speak('second');
    expect(speechService.isSpeaking).toBe(true);

    // Stale callback ignored — still true
    triggerSpeechCallback(0, 'onStopped');
    expect(speechService.isSpeaking).toBe(true);

    triggerSpeechCallback(1, 'onDone');
    expect(speechService.isSpeaking).toBe(false);
  });

  /**
   * PR 1 fix (was: "CURRENT BEHAVIOR: first onStopped sets isSpeaking=false even while second is playing"):
   * The cancellation token check causes the stale onStopped to return early,
   * so isSpeaking correctly stays true while the second utterance is playing.
   */
  it('first onStopped is ignored (stale token) — isSpeaking stays true while second plays', () => {
    speechService.speak('first');
    speechService.speak('second');

    // FIXED: stale callback ignored by cancellation token check
    triggerSpeechCallback(0, 'onStopped');
    expect(speechService.isSpeaking).toBe(true); // correctly true while second plays

    triggerSpeechCallback(1, 'onDone');
    expect(speechService.isSpeaking).toBe(false);
  });
});
