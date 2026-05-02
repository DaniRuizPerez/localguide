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
    expect(prompt).toContain('local guide');
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

  it('instructs the model to NOT assume the user is physically at the place', async () => {
    await service.ask('What is near me?', GPS_PARIS);
    const prompt: string = mockRunInferenceSpy.mock.calls[0][0];
    expect(prompt).toMatch(/never assume the user is physically there/i);
    expect(prompt).toContain('you are standing next to');
    expect(prompt).toContain('right in front of you');
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
import { devicePerf } from '../services/DevicePerf';

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

// ── OnlineGuideService mock ────────────────────────────────────────────────
// Default: llm-only (so existing source-badge tests continue to expect 'ai-online').
// Individual tests override mockDecide to simulate source-first / rag paths.
const mockDecide = jest.fn().mockResolvedValue({
  mode: 'llm-only',
  title: null,
  reference: null,
  sourceFirstText: null,
  thumbnail: null,
  source: 'ai-online',
});
jest.mock('../services/OnlineGuideService', () => ({
  onlineGuideService: {
    decide: (...args: unknown[]) => mockDecide(...args),
  },
}));

// ── DevicePerf — spy on perfClass rather than jest.mock the whole module ──
// We cannot use jest.mock('../services/DevicePerf') here: DevicePerf.test.ts
// calls jest.resetModules() + freshDevicePerf() which would pick up our mock
// factory instead of the real module and break those tests.
// Using jest.spyOn on the singleton avoids the registry pollution problem.
let mockPerfClass: 'fast' | 'slow' | 'unknown' = 'fast';
let perfClassSpy: jest.SpyInstance | null = null;
let recordStreamSpy: jest.SpyInstance | null = null;

beforeAll(() => {
  perfClassSpy = jest.spyOn(devicePerf, 'perfClass').mockImplementation(() => mockPerfClass);
  recordStreamSpy = jest.spyOn(devicePerf, 'recordStream').mockImplementation(() => {});
});

afterAll(() => {
  perfClassSpy?.mockRestore();
  recordStreamSpy?.mockRestore();
});

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

// ── W2: Online routing paths ─────────────────────────────────────────────────

describe('W2: online + perfClass=fast + factual query → source-first short-circuit (no LLM call)', () => {
  beforeEach(() => {
    mockEffectiveMode = 'online';
    mockPerfClass = 'fast';
    mockRunInferenceStreamSpy.mockClear();
    mockDecide.mockResolvedValue({
      mode: 'source-first',
      title: 'Eiffel Tower',
      reference: null,
      sourceFirstText: 'The Eiffel Tower is a wrought-iron lattice tower on the Champ de Mars.',
      thumbnail: null,
      source: 'wikipedia',
    });
  });

  afterEach(() => {
    // Restore default decide mock so other suites are unaffected.
    mockDecide.mockResolvedValue({
      mode: 'llm-only', title: null, reference: null, sourceFirstText: null, thumbnail: null, source: 'ai-online',
    });
  });

  it('guide message source is wikipedia and LLM is not called', async () => {
    const result = setupPipeline();
    await act(async () => {
      await result.current.guide.stream({ intent: 'text', query: 'Eiffel Tower', location: LOCATION });
    });

    // LLM stream must NOT have been called.
    expect(mockRunInferenceStreamSpy).not.toHaveBeenCalled();

    const guideMsg = result.current.msgs.messages.find((m) => m.role === 'guide');
    expect(guideMsg?.source).toBe('wikipedia');
    expect(guideMsg?.text).toContain('From Wikipedia:');
    expect(guideMsg?.text).toContain('The Eiffel Tower is a wrought-iron lattice tower');
  });
});

describe('W2: online + perfClass=fast + conversational query + Wikipedia hit → RAG path (LLM called with reference)', () => {
  const WIKI_EXTRACT = 'The Eiffel Tower was built in 1889 for the World Fair. It stands 330 metres tall.';

  beforeEach(() => {
    mockEffectiveMode = 'online';
    mockPerfClass = 'fast';
    mockRunInferenceStreamSpy.mockClear();
    mockDecide.mockResolvedValue({
      mode: 'rag',
      title: 'Eiffel Tower',
      reference: WIKI_EXTRACT,
      sourceFirstText: null,
      thumbnail: null,
      source: 'wikipedia',
    });
  });

  afterEach(() => {
    mockDecide.mockResolvedValue({
      mode: 'llm-only', title: null, reference: null, sourceFirstText: null, thumbnail: null, source: 'ai-online',
    });
  });

  it('LLM is called and guide message source is wikipedia', async () => {
    const result = setupPipeline();
    await act(async () => {
      await result.current.guide.stream({
        intent: 'text',
        query: 'Why is it so famous?',
        location: LOCATION,
      });
    });

    // LLM must have been called (RAG path runs Gemma).
    expect(mockRunInferenceStreamSpy).toHaveBeenCalledTimes(1);

    // The reference should appear in the prompt passed to the LLM.
    const promptArg = mockRunInferenceStreamSpy.mock.calls[0][0] as string;
    expect(promptArg).toContain(WIKI_EXTRACT);

    const guideMsg = result.current.msgs.messages.find((m) => m.role === 'guide');
    expect(guideMsg?.source).toBe('wikipedia');
  });
});

describe('W2: online + no Wikipedia hit → LLM-only with source=ai-online', () => {
  beforeEach(() => {
    mockEffectiveMode = 'online';
    mockPerfClass = 'fast';
    mockRunInferenceStreamSpy.mockClear();
    mockDecide.mockResolvedValue({
      mode: 'llm-only',
      title: null,
      reference: null,
      sourceFirstText: null,
      thumbnail: null,
      source: 'ai-online',
    });
  });

  it('guide message source is ai-online and LLM is called', async () => {
    const result = setupPipeline();
    await act(async () => {
      await result.current.guide.stream({ intent: 'text', query: 'What is cool here?', location: LOCATION });
    });

    expect(mockRunInferenceStreamSpy).toHaveBeenCalledTimes(1);

    const guideMsg = result.current.msgs.messages.find((m) => m.role === 'guide');
    expect(guideMsg?.source).toBe('ai-online');
  });
});

describe('W2: offline → LLM with source=ai-offline', () => {
  beforeEach(() => {
    mockEffectiveMode = 'offline';
    mockPerfClass = 'fast';
    mockDecide.mockClear();
    mockRunInferenceStreamSpy.mockClear();
  });

  it('guide message source is ai-offline and OnlineGuideService.decide is not called', async () => {
    const result = setupPipeline();
    await act(async () => {
      await result.current.guide.stream({ intent: 'text', query: 'What is cool here?', location: LOCATION });
    });

    // Offline mode must not consult OnlineGuideService.
    expect(mockDecide).not.toHaveBeenCalled();

    // LLM is still called (offline path).
    expect(mockRunInferenceStreamSpy).toHaveBeenCalledTimes(1);

    const guideMsg = result.current.msgs.messages.find((m) => m.role === 'guide');
    expect(guideMsg?.source).toBe('ai-offline');
  });
});

describe('W2: image intent → LLM-only regardless of mode (Decision D)', () => {
  beforeEach(() => {
    mockDecide.mockClear();
    mockRunInferenceStreamSpy.mockClear();
  });

  afterEach(() => {
    mockDecide.mockResolvedValue({
      mode: 'llm-only', title: null, reference: null, sourceFirstText: null, thumbnail: null, source: 'ai-online',
    });
  });

  it('online + image intent: OnlineGuideService.decide is NOT called, LLM is called', async () => {
    mockEffectiveMode = 'online';
    const result = setupPipeline();
    await act(async () => {
      await result.current.guide.stream({
        intent: 'image',
        query: 'What is this?',
        location: LOCATION,
        imageUri: 'file:///photo.jpg',
      });
    });

    expect(mockDecide).not.toHaveBeenCalled();
    expect(mockRunInferenceStreamSpy).toHaveBeenCalledTimes(1);

    const guideMsg = result.current.msgs.messages.find((m) => m.role === 'guide');
    // Image in online mode → ai-online source.
    expect(guideMsg?.source).toBe('ai-online');
  });

  it('offline + image intent: OnlineGuideService.decide is NOT called, source is ai-offline', async () => {
    mockEffectiveMode = 'offline';
    const result = setupPipeline();
    await act(async () => {
      await result.current.guide.stream({
        intent: 'image',
        query: 'What is this?',
        location: LOCATION,
        imageUri: 'file:///photo.jpg',
      });
    });

    expect(mockDecide).not.toHaveBeenCalled();
    expect(mockRunInferenceStreamSpy).toHaveBeenCalledTimes(1);

    const guideMsg = result.current.msgs.messages.find((m) => m.role === 'guide');
    expect(guideMsg?.source).toBe('ai-offline');
  });
});
