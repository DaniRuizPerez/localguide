/**
 * Regression: pronoun follow-ups must inherit the last-tagged POI subject.
 *
 * Bug repro: user asks "Tell me about Mountain View" (typed) → then taps
 * Hoover Tower POI which sends "Tell me about Hoover Tower" with
 * subjectPoi='Hoover Tower' → then types "tell me its history". Today the
 * third prompt's Place line falls back to GPS placeName (Mountain View)
 * and the model loses the Hoover Tower context. This test locks the new
 * behaviour: the third prompt must (a) carry a Subject directive naming
 * Hoover Tower, (b) use Hoover Tower as the Place line, and (c) propagate
 * Hoover Tower as poiTitle into onlineGuideService.decide.
 *
 * Also covers the explicit-reset path: a fourth "Tell me about this area"
 * with subjectPoi=null must wipe the inherited subject so a subsequent
 * pronoun follow-up does NOT re-anchor on Hoover Tower.
 */

// ── Native module + filesystem stubs (parallel useGuideStream.followUp.test.ts) ──
jest.mock('../native/LiteRTModule', () => ({ __esModule: true, default: undefined }));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///data/user/0/com.ai_offline_tourguide/files/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: false }),
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
}));

// ── Spy on the prompt that lands in the model + the routing call ─────────────
type StreamCbs = {
  onToken: (d: string) => void;
  onDone: () => void;
  onError: (m: string) => void;
};

const mockRunInferenceStreamSpy = jest.fn((_prompt: unknown, cbs: StreamCbs) => {
  queueMicrotask(() => {
    cbs?.onToken('ok.');
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

// ── AppMode: force online so the OnlineGuideService.decide path runs and we
//    can assert poiTitle context propagation. The decide() returns 'llm-only'
//    so the LLM path still fires after the routing call.
jest.mock('../services/AppMode', () => ({
  appMode: {
    get: () => 'online' as const,
    subscribe: () => () => {},
    __resetForTest: () => {},
  },
}));

const mockDecide = jest.fn().mockResolvedValue({
  mode: 'llm-only',
  title: null,
  reference: null,
  sourceFirstText: null,
  thumbnail: null,
  source: 'ai-online',
});
jest.mock('../services/OnlineGuideService', () => ({
  onlineGuideService: { decide: (...a: unknown[]) => mockDecide(...a) },
}));

jest.mock('../services/SpeechService', () => ({
  speechService: { enqueue: jest.fn(), stop: jest.fn() },
}));

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

import { renderHook, act } from '@testing-library/react-native';
import { useChatMessages } from '../hooks/useChatMessages';
import { useGuideStream } from '../hooks/useGuideStream';
import { chatStore } from '../services/ChatStore';

const _speakRef = { current: false };
const _topicRef = { current: [] as readonly never[] };
// GPS resolves to Mountain View — exactly the bug repro setup.
const GPS = { latitude: 37.4232, longitude: -122.1494, placeName: 'Mountain View, California' } as const;

function setupPipeline() {
  const { result } = renderHook(() => {
    const msgs = useChatMessages();
    const guide = useGuideStream({ speakResponsesRef: _speakRef, topicRef: _topicRef });
    return { msgs, guide };
  });
  return result;
}

describe('Regression: pronoun follow-up inherits last-tagged POI subject', () => {
  beforeEach(() => {
    mockRunInferenceStreamSpy.mockClear();
    mockDecide.mockClear();
    chatStore.clear();
  });

  it('Mountain View → POI tap Hoover Tower → "tell me its history" anchors on Hoover Tower', async () => {
    const result = setupPipeline();

    // Turn 1: typed cue, named place "Mountain View" — no subjectPoi tag,
    // extractCueSubject will pick it up live.
    await act(async () => {
      result.current.msgs.addUserMessage('Tell me about Mountain View');
      await result.current.guide.stream({
        intent: 'text',
        query: 'Tell me about Mountain View',
        location: GPS,
      });
    });

    // Turn 2: POI tap — subjectPoi='Hoover Tower' is set durably on the user msg.
    await act(async () => {
      result.current.msgs.addUserMessage('Tell me about Hoover Tower', { subjectPoi: 'Hoover Tower' });
      await result.current.guide.stream({
        intent: 'text',
        query: 'Tell me about Hoover Tower',
        location: GPS,
      });
    });

    // Turn 3: pronoun-only typed query. extractCueSubject(query) returns null
    // → inheritance walk finds Hoover Tower from the most recent tagged user msg.
    await act(async () => {
      result.current.msgs.addUserMessage('tell me its history');
      await result.current.guide.stream({
        intent: 'text',
        query: 'tell me its history',
        location: GPS,
      });
    });

    expect(mockRunInferenceStreamSpy).toHaveBeenCalledTimes(3);
    const thirdPrompt = mockRunInferenceStreamSpy.mock.calls[2][0] as string;

    // (a) Subject directive is present and names Hoover Tower.
    expect(thirdPrompt).toContain('Subject: Hoover Tower.');
    // (b) Place line is the inherited subject, NOT the GPS placeName.
    expect(thirdPrompt).toContain('Place: Hoover Tower');
    expect(thirdPrompt).not.toMatch(/Place: Mountain View/);

    // (c) onlineGuideService.decide receives the inherited subject as poiTitle
    // so Wikipedia title resolution can find the right article.
    const thirdDecideCall = mockDecide.mock.calls[2][0];
    expect(thirdDecideCall.context.poiTitle).toBe('Hoover Tower');
  });

  it('explicit "Tell me about this area" with subjectPoi=null wipes the inherited subject', async () => {
    const result = setupPipeline();

    // Turn 1: POI tap on Hoover Tower.
    await act(async () => {
      result.current.msgs.addUserMessage('Tell me about Hoover Tower', { subjectPoi: 'Hoover Tower' });
      await result.current.guide.stream({
        intent: 'text',
        query: 'Tell me about Hoover Tower',
        location: GPS,
      });
    });

    // Turn 2: explicit area-reset chip — subjectPoi=null is the load-bearing signal.
    await act(async () => {
      result.current.msgs.addUserMessage('Tell me about this area', { subjectPoi: null });
      await result.current.guide.stream({
        intent: 'text',
        query: 'Welcome the visitor to this area.',
        location: GPS,
      });
    });

    // Turn 3: pronoun follow-up — inheritance walk hits the null reset
    // BEFORE the older Hoover Tower tag, so the subject must be cleared.
    await act(async () => {
      result.current.msgs.addUserMessage('tell me more');
      await result.current.guide.stream({
        intent: 'text',
        query: 'tell me more',
        location: GPS,
      });
    });

    const thirdPrompt = mockRunInferenceStreamSpy.mock.calls[2][0] as string;

    // No Subject directive — the user reset to ambient context.
    expect(thirdPrompt).not.toContain('Subject: ');
    // Place falls back to GPS placeName, NOT the earlier POI subject.
    expect(thirdPrompt).toContain('Place: Mountain View');
    expect(thirdPrompt).not.toContain('Place: Hoover Tower');

    const thirdDecideCall = mockDecide.mock.calls[2][0];
    expect(thirdDecideCall.context.poiTitle).toBeNull();
  });
});
