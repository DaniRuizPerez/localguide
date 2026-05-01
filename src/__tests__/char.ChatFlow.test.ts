/**
 * Characterization: Chat flow
 *
 * Locks in current behavior of LocalGuideService prompt construction, response
 * shaping, and the InferenceService call contract.  These tests describe what
 * the code does TODAY — including quirks — so that refactor PRs can verify
 * nothing regressed.  If a PR intentionally changes behavior, update the
 * relevant assertion and leave a commit note explaining why.
 */

import { localGuideService } from '../services/LocalGuideService';
import type { GPSContext } from '../services/InferenceService';

// ── Mock the native module so InferenceService runs in mock mode ───────────
jest.mock('../native/LiteRTModule', () => ({ __esModule: true, default: undefined }));
// ── ModelDownloadService path constant (imported by InferenceService) ──────
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///data/user/0/com.localguideapp/files/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: false }),
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
}));

const GPS_PARIS: GPSContext = { latitude: 48.8566, longitude: 2.3522, accuracy: 10 };
const GPS_NO_ACCURACY: GPSContext = { latitude: 51.5074, longitude: -0.1278, accuracy: undefined };

// ── Intercept runInference so we can inspect the prompt ────────────────────
// Variable must be prefixed "mock" to be accessible inside jest.mock() factory
const mockRunInferenceSpy = jest.fn().mockResolvedValue('Some tourist info.');

// mockStreamCallbacks holds the last set of callbacks passed to runInferenceStream
// so that individual tests can drive onToken/onDone manually.
let mockStreamCallbacks: { onToken: (d: string) => void; onDone: () => void; onError: (m: string) => void } | null = null;
const mockRunInferenceStreamSpy = jest.fn(
  (_prompt: unknown, cbs: typeof mockStreamCallbacks) => {
    mockStreamCallbacks = cbs;
    // Emit a token + done on the next microtask so renderHook `act` can drain it.
    queueMicrotask(() => {
      cbs?.onToken('mock token');
      cbs?.onDone();
    });
    return Promise.resolve({ abort: jest.fn() });
  }
);

jest.mock('../services/InferenceService', () => {
  const actual = jest.requireActual('../services/InferenceService');
  return {
    ...actual,
    inferenceService: {
      initialize: jest.fn().mockResolvedValue(undefined),
      runInference: (...args: unknown[]) => mockRunInferenceSpy(...args),
      runInferenceStream: (...args: unknown[]) => mockRunInferenceStreamSpy(...args as Parameters<typeof mockRunInferenceStreamSpy>),
      dispose: jest.fn().mockResolvedValue(undefined),
      isLoaded: true,
    },
  };
});

describe('Characterization: LocalGuideService — prompt format', () => {
  let service: typeof localGuideService;

  beforeEach(() => {
    // LocalGuideService is a plain object export; use the module directly
    service = require('../services/LocalGuideService').localGuideService;
    mockRunInferenceSpy.mockClear();
    mockRunInferenceSpy.mockResolvedValue('Some tourist info.');
  });

  it('builds prompt with system header, coordinates, and user query', async () => {
    await service.ask('What is near me?', GPS_PARIS);

    expect(mockRunInferenceSpy).toHaveBeenCalledTimes(1);
    const prompt: string = mockRunInferenceSpy.mock.calls[0][0];

    // System prompt present
    expect(prompt).toContain('local tourist guide');
    // Coordinates line present (no placeName in this GPSContext, so the
    // builder keeps the raw numeric position as the only location signal).
    expect(prompt).toContain('Coordinates:');
    // Coordinates formatted to 6 decimal places
    expect(prompt).toContain('48.856600');
    expect(prompt).toContain('2.352200');
    // Accuracy appended when present
    expect(prompt).toContain('±10m');
    // User query surfaces as a Cue line (no delimiter wrapping anymore).
    expect(prompt).toContain('Cue: What is near me?');
  });

  it('omits accuracy note when accuracy is undefined', async () => {
    await service.ask('What is near me?', GPS_NO_ACCURACY);

    const prompt: string = mockRunInferenceSpy.mock.calls[0][0];
    expect(prompt).not.toContain('±');
    expect(prompt).toContain('51.507400');
  });

  it('uses default maxTokens of 512 when no options passed', async () => {
    await service.ask('test query', GPS_PARIS);
    const options = mockRunInferenceSpy.mock.calls[0][1];
    // No options object passed by LocalGuideService — InferenceService uses its default
    expect(options).toBeUndefined();
  });
});

describe('Characterization: LocalGuideService — response shaping', () => {
  let service: typeof localGuideService;

  beforeEach(() => {
    service = require('../services/LocalGuideService').localGuideService;
    mockRunInferenceSpy.mockClear();
  });

  it('trims leading/trailing whitespace from inference output', async () => {
    mockRunInferenceSpy.mockResolvedValue('  Trimmed response.  \n');
    const result = await service.ask('test', GPS_PARIS);
    expect(result.text).toBe('Trimmed response.');
  });

  it('returns locationUsed equal to the gps argument', async () => {
    mockRunInferenceSpy.mockResolvedValue('ok');
    const result = await service.ask('test', GPS_PARIS);
    expect(result.locationUsed).toBe(GPS_PARIS);
  });

  it('returns durationMs as a non-negative number', async () => {
    mockRunInferenceSpy.mockResolvedValue('ok');
    const result = await service.ask('test', GPS_PARIS);
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('propagates inference errors to the caller', async () => {
    mockRunInferenceSpy.mockRejectedValue(new Error('inference failure'));
    await expect(service.ask('test', GPS_PARIS)).rejects.toThrow('inference failure');
  });
});

// ── Source badge plumbing ─────────────────────────────────────────────────────
// These tests exercise the useChatMessages / useGuideStream integration —
// checking that every guide message carries the correct source field and that
// setGuideSource can override it after the fact.

import { renderHook, act } from '@testing-library/react-native';
import { useChatMessages } from '../hooks/useChatMessages';
import { useGuideStream } from '../hooks/useGuideStream';

let mockEffectiveMode: 'online' | 'offline' = 'online';

jest.mock('../services/AppMode', () => ({
  appMode: {
    get: () => mockEffectiveMode,
    subscribe: () => () => {},
    __resetForTest: () => {},
  },
}));

// SpeechService stub (useGuideStream uses it for TTS).
jest.mock('../services/SpeechService', () => ({
  speechService: { enqueue: jest.fn(), stop: jest.fn() },
}));

const _speakRef = { current: false };
const _topicRef = { current: [] as readonly never[] };
const LOCATION = 'Paris';

function setupPipeline() {
  const { result } = renderHook(() => {
    const msgs = useChatMessages();
    const guide = useGuideStream({ messages: msgs, speakResponsesRef: _speakRef, topicRef: _topicRef });
    return { msgs, guide };
  });
  return result;
}

describe('Characterization: source badge — useGuideStream online', () => {
  beforeEach(() => {
    mockEffectiveMode = 'online';
    mockRunInferenceStreamSpy.mockClear();
  });

  it('guide message source is ai-online when appMode is online', async () => {
    const result = setupPipeline();
    await act(async () => {
      await result.current.guide.stream({ intent: 'text', query: 'test', location: LOCATION });
    });

    const guideMsg = result.current.msgs.messages.find((m) => m.role === 'guide');
    expect(guideMsg?.source).toBe('ai-online');
  });
});

describe('Characterization: source badge — useGuideStream offline', () => {
  beforeEach(() => {
    mockEffectiveMode = 'offline';
    mockRunInferenceStreamSpy.mockClear();
  });

  it('guide message source is ai-offline when appMode is offline', async () => {
    const result = setupPipeline();
    await act(async () => {
      await result.current.guide.stream({ intent: 'text', query: 'test', location: LOCATION });
    });

    const guideMsg = result.current.msgs.messages.find((m) => m.role === 'guide');
    expect(guideMsg?.source).toBe('ai-offline');
  });
});

describe('Characterization: source badge — setGuideSource', () => {
  beforeEach(() => {
    mockEffectiveMode = 'online';
    mockRunInferenceStreamSpy.mockClear();
  });

  it('setGuideSource flips source to wikipedia after stream completes', async () => {
    const result = setupPipeline();
    await act(async () => {
      await result.current.guide.stream({ intent: 'text', query: 'test', location: LOCATION });
    });

    const guideMsg = result.current.msgs.messages.find((m) => m.role === 'guide');
    expect(guideMsg?.source).toBe('ai-online');

    act(() => {
      result.current.msgs.setGuideSource(guideMsg!.id, 'wikipedia');
    });

    const updated = result.current.msgs.messages.find((m) => m.id === guideMsg!.id);
    expect(updated?.source).toBe('wikipedia');
  });
});
