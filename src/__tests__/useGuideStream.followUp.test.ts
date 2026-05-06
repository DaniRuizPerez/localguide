/**
 * Regression: follow-up history threading via useGuideStream
 *
 * The wiring in useGuideStream.ts:91 snapshots `priorTurnsFor(messages.messages)`
 * before each stream call and passes it down through localGuideService.askStream
 * (line 219) into the prompt builder.  This test locks that contract: a second
 * stream() call must produce a prompt that contains text from the first guide
 * reply so that a future refactor cannot silently drop the history without
 * breaking this suite.
 *
 * Strategy: spy on inferenceService.runInferenceStream, drive two consecutive
 * stream() calls, and assert that mock.calls[1][0] (the prompt string for the
 * second call) contains a substring of the first guide reply.
 */

// ── Native module stubs (same as char.ChatFlow.test.ts) ──────────────────────
jest.mock('../native/LiteRTModule', () => ({ __esModule: true, default: undefined }));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///data/user/0/com.ai_offline_tourguide/files/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: false }),
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
}));

// ── runInferenceStream spy ────────────────────────────────────────────────────
// The variable MUST be prefixed "mock" to be accessible inside jest.mock().
// For call 1 the guide replies with a recognisable sentence; call 2 is any
// token so the stream completes cleanly.
const FIRST_GUIDE_REPLY = 'Stanford is a private research university founded in 1885.';
const SECOND_GUIDE_REPLY = 'It was founded by Leland Stanford after his son died.';

type StreamCbs = {
  onToken: (d: string) => void;
  onDone: () => void;
  onError: (m: string) => void;
};

let mockCallCount = 0;
const mockRunInferenceStreamSpy = jest.fn((_prompt: unknown, cbs: StreamCbs) => {
  mockCallCount += 1;
  const reply = mockCallCount === 1 ? FIRST_GUIDE_REPLY : SECOND_GUIDE_REPLY;
  queueMicrotask(() => {
    cbs?.onToken(reply);
    cbs?.onDone();
  });
  return Promise.resolve({ abort: jest.fn() });
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

// ── AppMode — force offline so OnlineGuideService is never consulted ─────────
jest.mock('../services/AppMode', () => ({
  appMode: {
    get: () => 'offline' as const,
    subscribe: () => () => {},
    __resetForTest: () => {},
  },
}));

// ── SpeechService stub ────────────────────────────────────────────────────────
jest.mock('../services/SpeechService', () => ({
  speechService: { enqueue: jest.fn(), stop: jest.fn() },
}));

// ── OnlineGuideService stub (should never be called in offline mode) ──────────
jest.mock('../services/OnlineGuideService', () => ({
  onlineGuideService: {
    decide: jest.fn().mockRejectedValue(new Error('OnlineGuideService.decide called in offline mode')),
  },
}));

// ── DevicePerf — spied rather than mock-replaced (avoids registry pollution) ──
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

// ── Render helpers ────────────────────────────────────────────────────────────
import { renderHook, act } from '@testing-library/react-native';
import { useChatMessages } from '../hooks/useChatMessages';
import { useGuideStream } from '../hooks/useGuideStream';

const _speakRef = { current: false };
const _topicRef = { current: [] as readonly never[] };
const LOCATION = 'Stanford, CA';

function setupPipeline() {
  const { result } = renderHook(() => {
    const msgs = useChatMessages();
    const guide = useGuideStream({ messages: msgs, speakResponsesRef: _speakRef, topicRef: _topicRef });
    return { msgs, guide };
  });
  return result;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Regression: follow-up history threading', () => {
  beforeEach(() => {
    mockCallCount = 0;
    mockRunInferenceStreamSpy.mockClear();
  });

  it('second stream() call prompt contains text from first guide reply', async () => {
    const result = setupPipeline();

    // ── Turn 1: user asks about Stanford ─────────────────────────────────────
    // Production pattern: addUserMessage and stream() are called synchronously
    // in the same event handler.  React batches the setState from addUserMessage,
    // so messages.messages has NOT updated yet when stream() snapshots history —
    // meaning Turn 1 starts with an empty history, which is correct.
    await act(async () => {
      result.current.msgs.addUserMessage('Tell me about Stanford');
      await result.current.guide.stream({
        intent: 'text',
        query: 'Tell me about Stanford',
        location: LOCATION,
      });
    });

    // Verify first turn completed and the guide bubble has text.
    const afterTurn1 = result.current.msgs.messages;
    const firstGuideMsg = afterTurn1.find((m) => m.role === 'guide');
    expect(firstGuideMsg?.text).toContain('Stanford');
    expect(mockRunInferenceStreamSpy).toHaveBeenCalledTimes(1);

    // After act() drains, messages state is committed: [user, guide] both have text.

    // ── Turn 2: user sends a follow-up ───────────────────────────────────────
    // Same production pattern: addUserMessage + stream() together.
    // At the moment stream() reads messages.messages, it sees the COMMITTED Turn 1
    // messages (user + guide with full text) but NOT the Turn 2 user message
    // (which is still batched).  That is exactly the history we want to assert.
    await act(async () => {
      result.current.msgs.addUserMessage('What about its founding?');
      await result.current.guide.stream({
        intent: 'text',
        query: 'What about its founding?',
        location: LOCATION,
      });
    });

    expect(mockRunInferenceStreamSpy).toHaveBeenCalledTimes(2);

    // ── Assert history was threaded into the second prompt ───────────────────
    // The second call's first argument is the prompt string.  It must contain
    // a recognisable substring from the first guide reply so we know
    // priorTurnsFor() ran and the history block was embedded.
    const secondPrompt = mockRunInferenceStreamSpy.mock.calls[1][0] as string;

    // The guide's first reply text must appear in the history block of the
    // second prompt.  LocalGuideService.renderHistoryBlock() clips to
    // MAX_CHARS_PER_TURN=280, so we match a short prefix.
    expect(secondPrompt).toContain('Stanford is a private research university');

    // The history block label is also a reliable canary.
    expect(secondPrompt).toContain('Previous conversation in this session');
  });

  it('first stream() call has no history block (cold start)', async () => {
    const result = setupPipeline();

    // On a fresh chat messages.messages is empty at the time stream() snapshots it,
    // so no history block should appear in the prompt.
    await act(async () => {
      result.current.msgs.addUserMessage('Tell me about Stanford');
      await result.current.guide.stream({
        intent: 'text',
        query: 'Tell me about Stanford',
        location: LOCATION,
      });
    });

    const firstPrompt = mockRunInferenceStreamSpy.mock.calls[0][0] as string;
    // On a fresh chat there are no prior turns so the history block must be absent.
    expect(firstPrompt).not.toContain('Previous conversation in this session');
  });
});
