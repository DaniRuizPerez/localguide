/**
 * Ensures the SpeechService honours persisted narrationPrefs (C2):
 *   - rate/voice from narrationPrefs feed into Speech.speak() options
 *   - speechService.setRate/setVoice write through to narrationPrefs
 *   - prefs changes propagate to subsequent utterances
 */

const mockSpeak = jest.fn();
const mockStop = jest.fn();

jest.mock('expo-speech', () => ({
  speak: (...args: unknown[]) => mockSpeak(...args),
  stop: (...args: unknown[]) => mockStop(...args),
  isSpeakingAsync: jest.fn().mockResolvedValue(false),
}));

function triggerSpeechCallback(
  callIndex: number,
  cb: 'onDone' | 'onError' | 'onStopped',
  arg?: unknown
): void {
  const options = mockSpeak.mock.calls[callIndex]?.[1];
  if (!options) throw new Error(`No speech call at index ${callIndex}`);
  options[cb]?.(arg);
}

describe('SpeechService × NarrationPrefs', () => {
  let speechService: typeof import('../services/SpeechService').speechService;
  let narrationPrefs: typeof import('../services/NarrationPrefs').narrationPrefs;

  beforeEach(() => {
    jest.resetModules();
    mockSpeak.mockClear();
    mockStop.mockClear();
    // Fresh modules so the SpeechService module-level IIFE subscribes to a
    // fresh narrationPrefs instance.
    narrationPrefs = require('../services/NarrationPrefs').narrationPrefs;
    narrationPrefs.__resetForTest();
    speechService = require('../services/SpeechService').speechService;
  });

  it('uses the current narrationPrefs rate for Speech.speak', () => {
    narrationPrefs.setRate(1.3);
    speechService.enqueue('Hello.');
    const options = mockSpeak.mock.calls[0][1];
    expect(options.rate).toBeCloseTo(1.3);
    triggerSpeechCallback(0, 'onDone');
  });

  it('uses the current narrationPrefs voice for Speech.speak', () => {
    narrationPrefs.setVoice('es-es-x-eef-local');
    speechService.enqueue('Hola.');
    const options = mockSpeak.mock.calls[0][1];
    expect(options.voice).toBe('es-es-x-eef-local');
    triggerSpeechCallback(0, 'onDone');
  });

  it('picks up a rate change mid-session for the next utterance', () => {
    speechService.enqueue('First.');
    expect(mockSpeak.mock.calls[0][1].rate).toBeCloseTo(0.95);
    triggerSpeechCallback(0, 'onDone');

    narrationPrefs.setRate(1.5);
    speechService.enqueue('Second.');
    expect(mockSpeak.mock.calls[1][1].rate).toBeCloseTo(1.5);
    triggerSpeechCallback(1, 'onDone');
  });

  it('speechService.setRate() persists via narrationPrefs', () => {
    speechService.setRate(1.1);
    expect(narrationPrefs.get().rate).toBeCloseTo(1.1);
  });

  it('speechService.setVoice() persists via narrationPrefs', () => {
    speechService.setVoice('fr-fr-x-frd-local');
    expect(narrationPrefs.get().voice).toBe('fr-fr-x-frd-local');
  });

  it('speechService.setRate() clamps out-of-range values', () => {
    speechService.setRate(5);
    expect(narrationPrefs.get().rate).toBe(2.0);
    speechService.setRate(0.01);
    expect(narrationPrefs.get().rate).toBe(0.5);
  });
});
