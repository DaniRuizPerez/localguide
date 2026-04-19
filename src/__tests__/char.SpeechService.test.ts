/**
 * Characterization: SpeechService
 *
 * Locks in current behavior — including the known race-condition quirk —
 * so PR 1 can deliberately update the tests that capture broken behavior
 * while keeping the ones that capture correct behavior green.
 *
 * Tests marked "CURRENT BEHAVIOR (pre-fix)" describe what the buggy code
 * does today.  PR 1 must update those specific assertions and leave a commit
 * note explaining the intentional change.
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

describe('Characterization: SpeechService — concurrent speak() (pre-fix baseline)', () => {
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
   * After the queue refactor, speak() unconditionally calls Speech.stop()
   * and clears the pending queue before dispatching the new utterance — so
   * two consecutive speak() calls produce two Speech.stop() calls, not one.
   */
  it('each speak() stops any in-flight speech and clears the queue', () => {
    speechService.speak('first');
    speechService.speak('second');

    expect(mockStop).toHaveBeenCalledTimes(2);
    expect(mockSpeak).toHaveBeenCalledTimes(2);
    expect(mockSpeak.mock.calls[1][0]).toBe('second');

    triggerSpeechCallback(0, 'onStopped');
    triggerSpeechCallback(1, 'onDone');
  });

  /**
   * CURRENT BEHAVIOR (pre-fix):
   * The module-level `speaking` flag is set to true by the first speak() call.
   * The second speak() call sees it and calls Speech.stop(), but the flag is
   * still true when the second Speech.speak() call begins.
   */
  it('CURRENT BEHAVIOR: isSpeaking remains true between the two speak() calls', () => {
    speechService.speak('first');
    expect(speechService.isSpeaking).toBe(true); // set by first call

    speechService.speak('second');
    expect(speechService.isSpeaking).toBe(true); // still true (second call set it again)

    triggerSpeechCallback(0, 'onStopped');
    triggerSpeechCallback(1, 'onDone');
  });

  /**
   * CURRENT BEHAVIOR (pre-fix):
   * When the first call's onStopped fires (after Speech.stop() interrupted it),
   * it resets the module-level `speaking = false`.  This happens even while the
   * second utterance is still in progress — so isSpeaking briefly reports false
   * while audio is actually playing.
   */
  it('CURRENT BEHAVIOR: first onStopped sets isSpeaking=false even while second is playing', () => {
    speechService.speak('first');
    speechService.speak('second');

    // First utterance stopped — its callback fires
    triggerSpeechCallback(0, 'onStopped');

    // BUG: speaking flag is now false even though second utterance is ongoing
    expect(speechService.isSpeaking).toBe(false);

    // Clean up
    triggerSpeechCallback(1, 'onDone');
  });
});

describe('SpeechService — queue-based enqueue()', () => {
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

  it('speaks the first enqueued segment immediately', () => {
    speechService.enqueue('First sentence.');
    expect(mockSpeak).toHaveBeenCalledTimes(1);
    expect(mockSpeak.mock.calls[0][0]).toBe('First sentence.');
    triggerSpeechCallback(0, 'onDone');
  });

  it('queues further segments and speaks them after the previous finishes', () => {
    speechService.enqueue('First.');
    speechService.enqueue('Second.');
    speechService.enqueue('Third.');

    // Only the first is spoken up front; the rest wait in the queue.
    expect(mockSpeak).toHaveBeenCalledTimes(1);

    triggerSpeechCallback(0, 'onDone');
    expect(mockSpeak).toHaveBeenCalledTimes(2);
    expect(mockSpeak.mock.calls[1][0]).toBe('Second.');

    triggerSpeechCallback(1, 'onDone');
    expect(mockSpeak).toHaveBeenCalledTimes(3);
    expect(mockSpeak.mock.calls[2][0]).toBe('Third.');

    triggerSpeechCallback(2, 'onDone');
  });

  it('keeps playing the queue when an individual segment errors', () => {
    speechService.enqueue('First.');
    speechService.enqueue('Second.');

    triggerSpeechCallback(0, 'onError', new Error('tts blip'));
    expect(mockSpeak).toHaveBeenCalledTimes(2);
    expect(mockSpeak.mock.calls[1][0]).toBe('Second.');
    triggerSpeechCallback(1, 'onDone');
  });

  it('ignores empty or whitespace-only segments', () => {
    speechService.enqueue('');
    speechService.enqueue('   \n  ');
    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it('stop() clears the queue so subsequent segments are dropped', () => {
    speechService.enqueue('First.');
    speechService.enqueue('Second.');
    speechService.enqueue('Third.');

    speechService.stop();
    triggerSpeechCallback(0, 'onStopped');

    // The queue was cleared before onStopped fired — the drain loop
    // should not pick up Second or Third.
    expect(mockSpeak).toHaveBeenCalledTimes(1);
  });

  it('speak() flushes any pending queued items', () => {
    speechService.enqueue('Queued one.');
    speechService.enqueue('Queued two.');

    // Barge-in with a direct speak() call.
    speechService.speak('Interrupt!');

    // mockStop called once for the initial enqueue path (via speak) and once by the
    // explicit speak(). We only care that the queue can't resurface afterward.
    triggerSpeechCallback(0, 'onStopped');
    triggerSpeechCallback(1, 'onDone');

    const spoken = mockSpeak.mock.calls.map((c) => c[0]);
    expect(spoken).not.toContain('Queued two.');
    expect(spoken).toContain('Interrupt!');
  });

  it('isSpeaking is true while any segment is queued, false after all drain', () => {
    speechService.enqueue('First.');
    speechService.enqueue('Second.');
    expect(speechService.isSpeaking).toBe(true);

    triggerSpeechCallback(0, 'onDone');
    expect(speechService.isSpeaking).toBe(true); // Second now playing

    triggerSpeechCallback(1, 'onDone');
    expect(speechService.isSpeaking).toBe(false);
  });
});
