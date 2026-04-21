/**
 * C5 — pause / resume / skip semantics for the queue-aware SpeechService.
 *
 * expo-speech has no native pause, so SpeechService implements pause by
 * stopping the current utterance and putting it back at the head of the
 * queue. These tests lock in that contract.
 */

const mockSpeak = jest.fn();
const mockStop = jest.fn();

jest.mock('expo-speech', () => ({
  speak: (...args: unknown[]) => mockSpeak(...args),
  stop: (...args: unknown[]) => mockStop(...args),
  isSpeakingAsync: jest.fn().mockResolvedValue(false),
}));

function triggerCallback(
  callIndex: number,
  cb: 'onDone' | 'onError' | 'onStopped',
  arg?: unknown
): void {
  const options = mockSpeak.mock.calls[callIndex]?.[1];
  if (!options) throw new Error(`No speech call at index ${callIndex}`);
  options[cb]?.(arg);
}

describe('SpeechService — playback controls (C5)', () => {
  let speechService: typeof import('../services/SpeechService').speechService;

  beforeEach(() => {
    jest.resetModules();
    mockSpeak.mockClear();
    mockStop.mockClear();
    const narrationPrefs = require('../services/NarrationPrefs').narrationPrefs;
    narrationPrefs.__resetForTest();
    speechService = require('../services/SpeechService').speechService;
  });

  it('starts idle', () => {
    expect(speechService.isSpeaking).toBe(false);
    expect(speechService.isPaused).toBe(false);
  });

  it('pause() stops speech, marks paused, preserves the current sentence for resume', () => {
    speechService.enqueue('First sentence.');
    speechService.enqueue('Second sentence.');
    expect(speechService.isSpeaking).toBe(true);
    expect(speechService.isPaused).toBe(false);

    speechService.pause();
    // Firing the native onStopped callback the same way a real engine would.
    triggerCallback(0, 'onStopped');

    expect(mockStop).toHaveBeenCalled();
    expect(speechService.isPaused).toBe(true);
    expect(speechService.queueLength).toBe(2); // first restored + second still queued
  });

  it('resume() from paused starts the first queued sentence (the one that was cut)', () => {
    speechService.enqueue('First sentence.');
    speechService.enqueue('Second sentence.');
    speechService.pause();
    triggerCallback(0, 'onStopped');

    mockSpeak.mockClear();
    speechService.resume();

    expect(mockSpeak).toHaveBeenCalledTimes(1);
    expect(mockSpeak.mock.calls[0][0]).toBe('First sentence.');
    expect(speechService.isPaused).toBe(false);
  });

  it('resume() is a no-op if not paused', () => {
    speechService.enqueue('First.');
    mockSpeak.mockClear();
    speechService.resume();
    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it('pause() twice is idempotent — does not double-restore the sentence', () => {
    speechService.enqueue('Only one.');
    speechService.pause();
    triggerCallback(0, 'onStopped');

    const lenAfterFirstPause = speechService.queueLength;
    speechService.pause();
    expect(speechService.queueLength).toBe(lenAfterFirstPause);
  });

  it('skipCurrent() drops the current sentence and auto-plays the next', () => {
    speechService.enqueue('Skip me.');
    speechService.enqueue('Keep me.');
    expect(mockSpeak.mock.calls[0][0]).toBe('Skip me.');

    speechService.skipCurrent();
    triggerCallback(0, 'onStopped'); // the skipped sentence's callback

    // After skip, speakNext() should have fired for "Keep me."
    expect(mockSpeak).toHaveBeenCalledTimes(2);
    expect(mockSpeak.mock.calls[1][0]).toBe('Keep me.');
    expect(speechService.isPaused).toBe(false);
  });

  it('enqueue() while paused un-pauses and resumes playback', () => {
    speechService.enqueue('First.');
    speechService.pause();
    triggerCallback(0, 'onStopped');
    expect(speechService.isPaused).toBe(true);

    mockSpeak.mockClear();
    speechService.enqueue('Second.');
    // "First." is still at head of queue (restored on pause), then "Second."
    // appended. Playback resumes with "First.".
    expect(speechService.isPaused).toBe(false);
    expect(mockSpeak).toHaveBeenCalledTimes(1);
    expect(mockSpeak.mock.calls[0][0]).toBe('First.');
  });

  it('stop() clears the queue and resets paused', () => {
    speechService.enqueue('One.');
    speechService.enqueue('Two.');
    speechService.pause();
    triggerCallback(0, 'onStopped');
    expect(speechService.queueLength).toBeGreaterThan(0);

    speechService.stop();
    expect(speechService.queueLength).toBe(0);
    expect(speechService.isPaused).toBe(false);
    expect(speechService.isSpeaking).toBe(false);
  });

  it('subscribe() notifies listeners on state changes', () => {
    const listener = jest.fn();
    const unsub = speechService.subscribe(listener);

    speechService.enqueue('Hello.');
    expect(listener).toHaveBeenCalled();
    listener.mockClear();

    speechService.pause();
    triggerCallback(0, 'onStopped');
    const paused = listener.mock.calls.some(([s]) => s.isPaused === true);
    expect(paused).toBe(true);

    unsub();
    listener.mockClear();
    speechService.resume();
    expect(listener).not.toHaveBeenCalled();
  });
});
