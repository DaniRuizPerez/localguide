/**
 * Integration test: the response postfilter is wired into useGuideStream.
 *
 * Drives a streaming inference mock that emits a repetition loop; asserts:
 *   - streamHandle.abort() is called once
 *   - finalizeGuideMessage runs once (no double-finalize when native then
 *     fires onDone post-abort)
 *   - the bubble body ends up as cleanedText + postfilter trailer
 *   - speechService.stop() is called
 *   - late onToken callbacks after abort are no-ops
 */

// ── Native module stubs (mirrors useGuideStream.followUp.test.ts) ────────────
jest.mock('../native/LiteRTModule', () => ({ __esModule: true, default: undefined }));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///data/user/0/com.ai_offline_tourguide/files/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: false }),
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
}));

// ── runInferenceStream spy: emits a repetition loop, then a late post-abort
//    onToken (which the hook should ignore), then onDone. ───────────────────
type StreamCbs = {
  onToken: (d: string) => void;
  onDone: () => void;
  onError: (m: string) => void;
};

const mockAbort = jest.fn();
let lateTokenSeen = false;

const mockRunInferenceStreamSpy = jest.fn((_prompt: unknown, cbs: StreamCbs) => {
  // setTimeout (macrotask) instead of queueMicrotask, so the await continuation
  // in useGuideStream.stream() runs first and assigns streamRef.current = handle
  // BEFORE the first onToken fires. Mirrors the production native stream which
  // emits asynchronously after the JS Promise has already resolved.
  setTimeout(() => {
    const looped = 'Hmm let me think. '.repeat(8);
    for (const ch of looped) cbs?.onToken(ch);
    // Native tends to deliver a stray token after abort() — verify the hook
    // drops it instead of appending. This also exercises the race guard.
    cbs?.onToken('LATE_TOKEN');
    lateTokenSeen = true;
    // And then native fires its own onDone — must not double-finalize.
    cbs?.onDone();
  }, 0);
  return Promise.resolve({ abort: mockAbort });
});

jest.mock('../services/InferenceService', () => {
  const actual = jest.requireActual('../services/InferenceService');
  return {
    ...actual,
    inferenceService: {
      initialize: jest.fn().mockResolvedValue(undefined),
      runInference: jest.fn().mockResolvedValue('ok'),
      runInferenceStream: (...args: unknown[]) =>
        mockRunInferenceStreamSpy(...(args as Parameters<typeof mockRunInferenceStreamSpy>)),
      dispose: jest.fn().mockResolvedValue(undefined),
      isLoaded: true,
    },
  };
});

// ── AppMode forced offline so OnlineGuideService is never consulted ──────────
jest.mock('../services/AppMode', () => ({
  appMode: {
    get: () => 'offline' as const,
    subscribe: () => () => {},
    __resetForTest: () => {},
  },
}));

// ── SpeechService — assertable stop() ────────────────────────────────────────
const mockSpeechStop = jest.fn();
jest.mock('../services/SpeechService', () => ({
  speechService: { enqueue: jest.fn(), stop: (...args: unknown[]) => mockSpeechStop(...args) },
}));

// ── OnlineGuideService stub (must not be called in offline mode) ─────────────
jest.mock('../services/OnlineGuideService', () => ({
  onlineGuideService: {
    decide: jest.fn().mockRejectedValue(new Error('OnlineGuideService.decide called in offline mode')),
  },
}));

// ── DevicePerf — spied so registry stays clean ───────────────────────────────
import { devicePerf } from '../services/DevicePerf';

let perfClassSpy: jest.SpyInstance | null = null;
let recordStreamSpy: jest.SpyInstance | null = null;

beforeAll(() => {
  perfClassSpy = jest.spyOn(devicePerf, 'perfClass').mockImplementation(() => 'fast');
  recordStreamSpy = jest.spyOn(devicePerf, 'recordStream').mockImplementation(() => {});
});

afterAll(() => {
  perfClassSpy?.mockRestore();
  recordStreamSpy?.mockRestore();
});

// ── Render helpers ───────────────────────────────────────────────────────────
import { renderHook, act } from '@testing-library/react-native';
import { useChatMessages } from '../hooks/useChatMessages';
import { useGuideStream } from '../hooks/useGuideStream';
import { chatStore } from '../services/ChatStore';

const speakRef = { current: false };
const topicRef = { current: [] as readonly never[] };

function setupPipeline() {
  const { result } = renderHook(() => {
    const msgs = useChatMessages();
    const guide = useGuideStream({ speakResponsesRef: speakRef, topicRef });
    return { msgs, guide };
  });
  return result;
}

describe('useGuideStream + responsePostfilter', () => {
  beforeEach(() => {
    mockRunInferenceStreamSpy.mockClear();
    mockAbort.mockClear();
    mockSpeechStop.mockClear();
    lateTokenSeen = false;
    chatStore.clear();
  });

  it('aborts a repetition loop, replaces bubble with cleaned text + trailer, drops late tokens', async () => {
    const finalizeSpy = jest.spyOn(chatStore, 'finalizeGuideMessage');
    const result = setupPipeline();

    await act(async () => {
      result.current.msgs.addUserMessage('Tell me about Stanford');
      await result.current.guide.stream({
        intent: 'text',
        query: 'Tell me about Stanford',
        location: 'Stanford, CA',
      });
    });

    // Mock did get to the late-token line — confirms our test setup ran fully.
    expect(lateTokenSeen).toBe(true);

    // streamHandle.abort() called exactly once.
    expect(mockAbort).toHaveBeenCalledTimes(1);

    // Speech stopped (don't read the loop aloud).
    expect(mockSpeechStop).toHaveBeenCalled();

    // Final bubble body: cleaned tail (no full repeat) + the trailer.
    const guide = result.current.msgs.messages.find((m) => m.role === 'guide');
    expect(guide).toBeDefined();
    expect(guide!.text).toMatch(/got stuck repeating/);
    // The body should NOT contain the late post-abort token.
    expect(guide!.text).not.toContain('LATE_TOKEN');

    // Idempotent finalize: only one call for the aborted bubble.
    const finalizesForBubble = finalizeSpy.mock.calls.filter(
      ([id]) => id === guide!.id,
    );
    expect(finalizesForBubble).toHaveLength(1);

    finalizeSpy.mockRestore();
  });
});
