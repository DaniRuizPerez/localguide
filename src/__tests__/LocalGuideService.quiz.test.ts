/**
 * H3 — quiz prompt + parser + streaming generator.
 *
 * The streaming generator now makes ONE inference call per question (not one
 * batch call for all 5). The test harness tracks every call so we can drive
 * each question's stream independently and assert the prompt sequence.
 */

interface CallRecord {
  prompt: string;
  callbacks: any;
}

const callQueue: CallRecord[] = [];
const mockRunStream = jest.fn((prompt: string, callbacks: any) => {
  callQueue.push({ prompt, callbacks });
});

// Backwards-compat alias for the older single-call tests in this file. Always
// points at the most recent call's callbacks.
const sharedCallbacks: { current: any } = { current: null };

function flushMicrotasks() {
  return new Promise((r) => setImmediate(r));
}

// Drive the most recent inference call to a successful completion with the
// given streamed text. Waits a microtask first so the SUT's promise wiring
// (`.then` after `runInferenceStream`) has a chance to attach.
async function completeNextCallWith(text: string) {
  await flushMicrotasks();
  const call = callQueue[callQueue.length - 1];
  call.callbacks.onToken(text);
  call.callbacks.onDone();
  // Allow the SUT's per-question continuation to schedule the next call.
  await flushMicrotasks();
}

jest.mock('../services/InferenceService', () => {
  const actual = jest.requireActual('../services/InferenceService');
  class Patched extends actual.InferenceService {
    async runInferenceStream(prompt: string, callbacks: any) {
      mockRunStream(prompt, callbacks);
      sharedCallbacks.current = callbacks;
      return { abort: jest.fn().mockResolvedValue(undefined) };
    }
  }
  return {
    ...actual,
    InferenceService: Patched,
    inferenceService: new Patched(),
  };
});

// --- AppMode mock (controlled per test) ---
let mockAppModeValue: 'online' | 'offline' = 'offline';
jest.mock('../services/AppMode', () => ({
  appMode: {
    get: () => mockAppModeValue,
    subscribe: jest.fn(() => () => {}),
    __resetForTest: jest.fn(),
  },
}));

// --- WikipediaService mock (controlled per test) ---
let mockWikiSummary: jest.Mock;
jest.mock('../services/WikipediaService', () => {
  mockWikiSummary = jest.fn();
  return {
    wikipediaService: {
      summary: (...args: any[]) => mockWikiSummary(...args),
      historySection: jest.fn().mockResolvedValue(null),
      summarize: jest.fn().mockResolvedValue(null),
      clearCache: jest.fn(),
    },
  };
});

import { localGuideService } from '../services/LocalGuideService';

beforeEach(() => {
  mockRunStream.mockClear();
  callQueue.length = 0;
  sharedCallbacks.current = null;
  mockAppModeValue = 'offline';
  if (mockWikiSummary) mockWikiSummary.mockReset();
});

describe('generateQuiz', () => {
  afterAll(async () => {
    await localGuideService.dispose();
  });

  it('includes the POI list and requested question count in the prompt', async () => {
    const task = localGuideService.generateQuiz(['Eiffel Tower', 'Louvre'], 3);
    const done = task.promise;
    await flushMicrotasks();
    sharedCallbacks.current.onToken('');
    sharedCallbacks.current.onDone();
    await done;
    const prompt = mockRunStream.mock.calls[0][0];
    expect(prompt).toContain('Eiffel Tower');
    expect(prompt).toContain('Louvre');
    expect(prompt).toContain('exactly 3');
  });

  it('includes the location label when provided', async () => {
    const task = localGuideService.generateQuiz(
      ['Stanford University'],
      3,
      'Palo Alto, California'
    );
    const done = task.promise;
    await flushMicrotasks();
    sharedCallbacks.current.onToken('');
    sharedCallbacks.current.onDone();
    await done;
    const prompt = mockRunStream.mock.calls[0][0];
    expect(prompt).toMatch(/Location:\s*Palo Alto, California/);
    // Anti-drift directive is what stops Gemma from substituting Rome /
    // Paris when it doesn't know the area.
    expect(prompt.toLowerCase()).toContain('never substitute');
  });

  it('parses well-formed Q/A/B/C/D/Correct blocks', async () => {
    const task = localGuideService.generateQuiz([], 2);
    const done = task.promise;
    await flushMicrotasks();
    sharedCallbacks.current.onToken(
      `Q: When was the Eiffel Tower built?\n` +
      `A: 1789\n` +
      `B: 1889\n` +
      `C: 1945\n` +
      `D: 1900\n` +
      `Correct: B\n\n` +
      `Q: Which river flows through Paris?\n` +
      `A: Thames\n` +
      `B: Danube\n` +
      `C: Seine\n` +
      `D: Rhine\n` +
      `Correct: C\n`
    );
    sharedCallbacks.current.onDone();
    const quiz = await done;

    expect(quiz).toHaveLength(2);
    expect(quiz[0]).toEqual({
      question: 'When was the Eiffel Tower built?',
      options: ['1789', '1889', '1945', '1900'],
      correctIndex: 1,
    });
    expect(quiz[1].correctIndex).toBe(2);
    expect(quiz[1].options).toEqual(['Thames', 'Danube', 'Seine', 'Rhine']);
  });

  it('tolerates "Answer:" instead of "Correct:" and bold markdown labels', async () => {
    const task = localGuideService.generateQuiz([], 1);
    const done = task.promise;
    await flushMicrotasks();
    sharedCallbacks.current.onToken(
      `**Q:** Which river flows through Paris?\n` +
      `A: Thames\n` +
      `B: Danube\n` +
      `C: Seine\n` +
      `D: Rhine\n` +
      `**Answer:** C\n`
    );
    sharedCallbacks.current.onDone();
    const quiz = await done;
    expect(quiz).toHaveLength(1);
    expect(quiz[0].question).toBe('Which river flows through Paris?');
    expect(quiz[0].correctIndex).toBe(2);
  });

  it('parses parenthesized option labels like "(A)" and "[A]"', async () => {
    const task = localGuideService.generateQuiz([], 1);
    const done = task.promise;
    await flushMicrotasks();
    sharedCallbacks.current.onToken(
      `Q: Capital of France?\n` +
      `(A) London\n` +
      `(B) Berlin\n` +
      `(C) Paris\n` +
      `(D) Madrid\n` +
      `Correct: C\n`
    );
    sharedCallbacks.current.onDone();
    const quiz = await done;
    expect(quiz).toHaveLength(1);
    expect(quiz[0].options).toEqual(['London', 'Berlin', 'Paris', 'Madrid']);
    expect(quiz[0].correctIndex).toBe(2);
  });

  it('parses options with no space after the separator ("A:foo")', async () => {
    // On-device Gemma 3 1B routinely drops the space between the option
    // letter's punctuation and the option text — observed live on Pixel 3 as
    // `A:12th Street Square`. Parser must accept it.
    const task = localGuideService.generateQuiz([], 1);
    const done = task.promise;
    await flushMicrotasks();
    sharedCallbacks.current.onToken(
      `Q: Largest city?\n` +
      `A:Paris\n` +
      `B:Berlin\n` +
      `C:Madrid\n` +
      `D:Rome\n` +
      `Correct: A\n`
    );
    sharedCallbacks.current.onDone();
    const quiz = await done;
    expect(quiz).toHaveLength(1);
    expect(quiz[0].options).toEqual(['Paris', 'Berlin', 'Madrid', 'Rome']);
    expect(quiz[0].correctIndex).toBe(0);
  });

  it('does not strip a leading "A" from an option that lacks a separator', async () => {
    // Defensive against the obvious foot-gun: relaxing the prefix regex too
    // far would make `Aardvark` get parsed as option A "ardvark".
    const task = localGuideService.generateQuiz([], 1);
    const done = task.promise;
    await flushMicrotasks();
    sharedCallbacks.current.onToken(
      `Q: Animal?\n` +
      `A: Aardvark\n` +
      `B: Beaver\n` +
      `C: Cougar\n` +
      `D: Deer\n` +
      `Correct: A\n`
    );
    sharedCallbacks.current.onDone();
    const quiz = await done;
    expect(quiz).toHaveLength(1);
    expect(quiz[0].options[0]).toBe('Aardvark');
  });

  it('infers correct answer from a "(correct)" tag and strips it from the option', async () => {
    const task = localGuideService.generateQuiz([], 1);
    const done = task.promise;
    await flushMicrotasks();
    sharedCallbacks.current.onToken(
      `Q: Largest planet?\n` +
      `A: Earth\n` +
      `B: Jupiter (correct)\n` +
      `C: Mars\n` +
      `D: Venus\n`
    );
    sharedCallbacks.current.onDone();
    const quiz = await done;
    expect(quiz).toHaveLength(1);
    expect(quiz[0].correctIndex).toBe(1);
    // The marker must NOT survive into the rendered option, otherwise the
    // quiz UI would give away the answer.
    expect(quiz[0].options[1]).toBe('Jupiter');
  });

  it('infers correct answer from a "[correct]" tag and strips it from the option', async () => {
    // Matches the prompt's worked example shape — the on-device 1B model
    // copied this format reliably in device tests after we moved the
    // marker inline (it kept dropping the trailing "Correct: <letter>").
    const task = localGuideService.generateQuiz([], 1);
    const done = task.promise;
    await flushMicrotasks();
    sharedCallbacks.current.onToken(
      `Q: Which river runs through London?\n` +
      `A: The Seine\n` +
      `B: The Thames [correct]\n` +
      `C: The Danube\n` +
      `D: The Rhine\n`
    );
    sharedCallbacks.current.onDone();
    const quiz = await done;
    expect(quiz).toHaveLength(1);
    expect(quiz[0].correctIndex).toBe(1);
    expect(quiz[0].options[1]).toBe('The Thames');
  });

  it('skips malformed blocks (missing options, missing Correct line)', async () => {
    const task = localGuideService.generateQuiz([], 3);
    const done = task.promise;
    await flushMicrotasks();
    sharedCallbacks.current.onToken(
      `Q: Half question?\n` +
      `A: maybe\n` +
      `B: yes\n` +
      `Correct: B\n\n` + // missing C, D
      `Q: Good question?\n` +
      `A: one\n` +
      `B: two\n` +
      `C: three\n` +
      `D: four\n` +
      `Correct: A\n`
    );
    sharedCallbacks.current.onDone();
    const quiz = await done;
    expect(quiz).toHaveLength(1);
    expect(quiz[0].question).toBe('Good question?');
  });

  it('rejects blocks where two or more options are duplicates', async () => {
    const task = localGuideService.generateQuiz([], 2);
    const done = task.promise;
    await flushMicrotasks();
    sharedCallbacks.current.onToken(
      // First block: A and B both "1850" — duplicate distractor, must be
      // dropped so the user never sees a 4-way choice that is really 3.
      `Q: When was X founded?\n` +
      `A: 1850\n` +
      `B: 1850\n` +
      `C: 1894\n` +
      `D: 1920\n` +
      `Correct: C\n\n` +
      // Whitespace/case-only differences also collapse — "Seine " vs
      // "seine" should not both appear in the option list.
      `Q: River?\n` +
      `A: Thames\n` +
      `B: Seine \n` +
      `C: seine\n` +
      `D: Rhine\n` +
      `Correct: B\n\n` +
      // Clean block — survives.
      `Q: Capital?\n` +
      `A: Paris\n` +
      `B: London\n` +
      `C: Rome\n` +
      `D: Berlin\n` +
      `Correct: A\n`
    );
    sharedCallbacks.current.onDone();
    const quiz = await done;
    expect(quiz).toHaveLength(1);
    expect(quiz[0].question).toBe('Capital?');
  });

  it('rejects Correct values outside A..D', async () => {
    const task = localGuideService.generateQuiz([], 1);
    const done = task.promise;
    await flushMicrotasks();
    sharedCallbacks.current.onToken(
      `Q: Q?\n` +
      `A: a\n` +
      `B: b\n` +
      `C: c\n` +
      `D: d\n` +
      `Correct: X\n`
    );
    sharedCallbacks.current.onDone();
    const quiz = await done;
    expect(quiz).toHaveLength(0);
  });

  it('propagates errors', async () => {
    const task = localGuideService.generateQuiz([], 5);
    const done = task.promise;
    await flushMicrotasks();
    sharedCallbacks.current.onError('inference oom');
    await expect(done).rejects.toThrow('inference oom');
  });
});

describe('generateQuizStream', () => {
  afterAll(async () => {
    await localGuideService.dispose();
  });

  // The streaming API runs ONE inference call per question and threads the
  // already-emitted question texts into the next prompt, so the model can't
  // (a) drift to Rome when the POI list is thin and (b) repeat itself. These
  // tests pin down both behaviours plus the JS-side dedupe-and-retry guard
  // that catches the model when it ignores the do-not-repeat instruction.

  const oneQuestion = (n: number, correct = 'A') =>
    `Q: Q${n}?\nA: a${n}\nB: b${n}\nC: c${n}\nD: d${n}\nCorrect: ${correct}\n`;

  it('emits each question as its own inference call completes', async () => {
    const onQuestion = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    localGuideService.generateQuizStream(
      [],
      3,
      { onQuestion, onDone, onError }
    );

    await completeNextCallWith(oneQuestion(1));
    expect(onQuestion).toHaveBeenCalledTimes(1);
    expect(onQuestion).toHaveBeenLastCalledWith(
      expect.objectContaining({ question: 'Q1?', correctIndex: 0 }),
      0
    );
    expect(onDone).not.toHaveBeenCalled();

    await completeNextCallWith(oneQuestion(2, 'B'));
    expect(onQuestion).toHaveBeenCalledTimes(2);
    expect(onQuestion).toHaveBeenLastCalledWith(
      expect.objectContaining({ question: 'Q2?', correctIndex: 1 }),
      1
    );

    await completeNextCallWith(oneQuestion(3, 'C'));
    expect(onQuestion).toHaveBeenCalledTimes(3);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0][0]).toHaveLength(3);
  });

  it('threads previous question texts into each subsequent prompt', async () => {
    const onQuestion = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    localGuideService.generateQuizStream(
      ['Stanford University'],
      3,
      { onQuestion, onDone, onError },
      'Palo Alto, California'
    );

    await completeNextCallWith(
      `Q: When was Stanford University founded?\n` +
        `A: 1885\n` +
        `B: 1891\n` +
        `C: 1900\n` +
        `D: 1920\n` +
        `Correct: B\n`
    );

    // The 1st prompt has no avoid line; the 2nd must reference Q1.
    // Both prompts must carry a TOPIC angle (rotation drives variety).
    const firstPrompt: string = mockRunStream.mock.calls[0][0];
    expect(firstPrompt).not.toContain('Do NOT repeat');
    expect(firstPrompt).toContain('TOPIC for this question:');

    await completeNextCallWith(
      `Q: What river runs near Palo Alto?\n` +
        `A: Hudson\n` +
        `B: Seine\n` +
        `C: San Francisquito Creek\n` +
        `D: Thames\n` +
        `Correct: C\n`
    );
    const secondPrompt: string = mockRunStream.mock.calls[1][0];
    expect(secondPrompt).toContain('Do NOT repeat');
    expect(secondPrompt).toContain('When was Stanford University founded?');
    expect(secondPrompt).toContain('Palo Alto, California');
    expect(secondPrompt).toContain('TOPIC for this question:');
    // Slot 0 and slot 1 must request different topic angles, otherwise
    // the rotation has degenerated.
    const firstAngle = firstPrompt.match(/TOPIC for this question: ([^\n]+)/)?.[1];
    const secondAngle = secondPrompt.match(/TOPIC for this question: ([^\n]+)/)?.[1];
    expect(firstAngle).toBeTruthy();
    expect(secondAngle).toBeTruthy();
    expect(firstAngle).not.toBe(secondAngle);

    await completeNextCallWith(
      `Q: What is Palo Alto known for?\n` +
        `A: Tech industry\n` +
        `B: Olive oil\n` +
        `C: Wine\n` +
        `D: Coal\n` +
        `Correct: A\n`
    );
    const thirdPrompt: string = mockRunStream.mock.calls[2][0];
    // Avoid-line names only the most recent question; full history is
    // implicit via topic rotation.
    expect(thirdPrompt).toContain('What river runs near Palo Alto?');
    const thirdAngle = thirdPrompt.match(/TOPIC for this question: ([^\n]+)/)?.[1];
    expect(thirdAngle).toBeTruthy();
    expect(thirdAngle).not.toBe(secondAngle);
  });

  it('rejects a duplicate question and re-invokes inference for that slot', async () => {
    const onQuestion = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    localGuideService.generateQuizStream(
      [],
      2,
      { onQuestion, onDone, onError }
    );

    // Q1 is unique — accepted.
    await completeNextCallWith(
      `Q: When was the Eiffel Tower built?\n` +
        `A: 1789\nB: 1889\nC: 1945\nD: 1900\nCorrect: B\n`
    );
    expect(onQuestion).toHaveBeenCalledTimes(1);

    // Q2 attempt #1: the model returns essentially the same question — should
    // be rejected and not delivered to the UI.
    await completeNextCallWith(
      `Q: When was the Eiffel Tower built?\n` +
        `A: 1789\nB: 1889\nC: 1945\nD: 1900\nCorrect: B\n`
    );
    expect(onQuestion).toHaveBeenCalledTimes(1);

    // Retry returns a fresh topic — accepted.
    await completeNextCallWith(
      `Q: Which river flows through Paris?\n` +
        `A: Thames\nB: Danube\nC: Seine\nD: Rhine\nCorrect: C\n`
    );
    expect(onQuestion).toHaveBeenCalledTimes(2);
    // 3 inference calls total: Q1, Q2-attempt-1 (rejected), Q2-attempt-2 (accepted).
    expect(mockRunStream).toHaveBeenCalledTimes(3);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0][0]).toHaveLength(2);

    // Each retry of the same slot must request a *different* topic angle —
    // otherwise the model regenerates the same prompt and the dedupe
    // budget is wasted (observed live on Pixel 3 before this fix).
    const slot1Initial: string = mockRunStream.mock.calls[1][0];
    const slot1Retry: string = mockRunStream.mock.calls[2][0];
    const slot1InitialAngle = slot1Initial.match(/TOPIC for this question: ([^\n]+)/)?.[1];
    const slot1RetryAngle = slot1Retry.match(/TOPIC for this question: ([^\n]+)/)?.[1];
    expect(slot1InitialAngle).toBeTruthy();
    expect(slot1RetryAngle).toBeTruthy();
    expect(slot1InitialAngle).not.toBe(slot1RetryAngle);
  });

  it('caps dedupe retries per slot and skips to the next', async () => {
    const onQuestion = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    localGuideService.generateQuizStream(
      [],
      2,
      { onQuestion, onDone, onError }
    );

    // Q1: accept.
    await completeNextCallWith(
      `Q: First question?\nA: a\nB: b\nC: c\nD: d\nCorrect: A\n`
    );
    // Q2 slot: every attempt is a duplicate of Q1. Initial + 2 retries = 3.
    // After all three collide, the slot is skipped; with count=2 the run
    // ends with whatever was accepted (just Q1).
    await completeNextCallWith(
      `Q: First question?\nA: a\nB: b\nC: c\nD: d\nCorrect: A\n`
    );
    await completeNextCallWith(
      `Q: First question?\nA: a\nB: b\nC: c\nD: d\nCorrect: A\n`
    );
    await completeNextCallWith(
      `Q: First question?\nA: a\nB: b\nC: c\nD: d\nCorrect: A\n`
    );

    expect(onQuestion).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0][0]).toHaveLength(1);
  });

  it('skips a slot that fails to parse and continues with the next', async () => {
    const onQuestion = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    localGuideService.generateQuizStream(
      [],
      2,
      { onQuestion, onDone, onError }
    );

    // Q1: three attempts of unparseable garbage — the slot is skipped.
    await completeNextCallWith('totally unstructured nonsense');
    await completeNextCallWith('still no Q: prefix anywhere');
    await completeNextCallWith('and a third dud');
    // Q2: parses fine. The run should continue past the failed slot and
    // land this question.
    await completeNextCallWith(
      `Q: Capital of Japan?\nA: Kyoto\nB: Osaka\nC: Tokyo\nD: Sapporo\nCorrect: C\n`
    );

    expect(onQuestion).toHaveBeenCalledTimes(1);
    expect(onQuestion.mock.calls[0][0].question).toBe('Capital of Japan?');
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0][0]).toHaveLength(1);
  });

  it('forwards model errors via onError', async () => {
    const onQuestion = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    localGuideService.generateQuizStream(
      [],
      5,
      { onQuestion, onDone, onError }
    );
    await flushMicrotasks();
    callQueue[0].callbacks.onError('inference oom');
    await flushMicrotasks();

    expect(onError).toHaveBeenCalledWith('inference oom');
    expect(onDone).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Wave 5: Wikipedia RAG + source tagging
// ────────────────────────────────────────────────────────────────────────────

describe('generateQuizStream — W5 Wikipedia RAG', () => {
  afterAll(async () => {
    await localGuideService.dispose();
  });

  const oneQuestion = (n: number, correct = 'A') =>
    `Q: Q${n}?\nA: a${n}\nB: b${n}\nC: c${n}\nD: d${n}\nCorrect: ${correct}\n`;

  it('offline → LLM-only, source="ai-offline"', async () => {
    mockAppModeValue = 'offline';
    if (mockWikiSummary) mockWikiSummary.mockResolvedValue(null);

    const onQuestion = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    localGuideService.generateQuizStream(
      ['Stanford University'],
      1,
      { onQuestion, onDone, onError },
      'Palo Alto, California'
    );

    await completeNextCallWith(oneQuestion(1));

    expect(onQuestion).toHaveBeenCalledTimes(1);
    expect(onQuestion.mock.calls[0][0]).toMatchObject({ source: 'ai-offline' });
    // Wikipedia should NOT be called in offline mode.
    if (mockWikiSummary) expect(mockWikiSummary).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('online + Wikipedia hit → reference passed to LLM, source="wikipedia"', async () => {
    mockAppModeValue = 'online';
    const extract = 'Stanford University is a private research university in Stanford, California.';
    if (mockWikiSummary) mockWikiSummary.mockResolvedValue({ extract, title: 'Stanford University', pageUrl: '' });

    const onQuestion = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    localGuideService.generateQuizStream(
      ['Stanford University'],
      1,
      { onQuestion, onDone, onError },
      'Palo Alto, California'
    );

    await completeNextCallWith(oneQuestion(1));

    expect(onQuestion).toHaveBeenCalledTimes(1);
    expect(onQuestion.mock.calls[0][0]).toMatchObject({ source: 'wikipedia' });
    // The Wikipedia extract must appear in the prompt sent to the LLM.
    const prompt: string = mockRunStream.mock.calls[0][0];
    expect(prompt).toContain('Stanford University is a private research university');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('online + Wikipedia null for a title → that question tagged "ai-online"', async () => {
    mockAppModeValue = 'online';
    // Wikipedia returns null (e.g. 404 or network error).
    if (mockWikiSummary) mockWikiSummary.mockResolvedValue(null);

    const onQuestion = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    localGuideService.generateQuizStream(
      ['Unknown POI'],
      1,
      { onQuestion, onDone, onError }
    );

    await completeNextCallWith(oneQuestion(1));

    expect(onQuestion).toHaveBeenCalledTimes(1);
    expect(onQuestion.mock.calls[0][0]).toMatchObject({ source: 'ai-online' });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('online with prefetch: prefetchQuiz also threads Wikipedia reference', async () => {
    mockAppModeValue = 'online';
    const extract = 'The Louvre is the world famous art museum in Paris.';
    if (mockWikiSummary) mockWikiSummary.mockResolvedValue({ extract, title: 'Louvre', pageUrl: '' });

    // Trigger the prefetch path which internally calls generateQuizStream.
    localGuideService.prefetchQuiz(['Louvre'], 1, 'Paris, France');

    // Drive the single question to completion.
    await completeNextCallWith(oneQuestion(1));
    await flushMicrotasks();

    // The prompt must contain the Wikipedia extract.
    const prompt: string = mockRunStream.mock.calls[mockRunStream.mock.calls.length - 1][0];
    expect(prompt).toContain('The Louvre is the world famous art museum in Paris.');
  });

  it('online concurrency cap: semaphore never allows more than 3 in-flight Wikipedia calls', async () => {
    // This test exercises the semaphore in isolation by calling generateQuizStream
    // with count=5 but checking that Wikipedia is called at most once per sequential
    // question slot. Since the driver is sequential (one slot at a time), the
    // semaphore primarily serves as a guard against future parallelism. We verify:
    // (a) Wikipedia is called for each online question (with a title), and
    // (b) the semaphore allows at least 1 call through (i.e., it resolves properly).
    mockAppModeValue = 'online';

    let maxInFlight = 0;
    let currentInFlight = 0;

    if (mockWikiSummary) {
      mockWikiSummary.mockImplementation(() => {
        currentInFlight++;
        if (currentInFlight > maxInFlight) maxInFlight = currentInFlight;
        return Promise.resolve({ extract: 'Some Wikipedia content.', title: 'POI', pageUrl: '' }).then((r) => {
          currentInFlight--;
          return r;
        });
      });
    }

    const onQuestion = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    localGuideService.generateQuizStream(
      ['POI1', 'POI2', 'POI3', 'POI4', 'POI5'],
      5,
      { onQuestion, onDone, onError }
    );

    // Drive all 5 questions to completion.
    for (let i = 0; i < 5; i++) {
      await completeNextCallWith(oneQuestion(i + 1));
    }

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onQuestion).toHaveBeenCalledTimes(5);
    // Each question should have been tagged 'wikipedia' since all got a summary.
    for (const call of onQuestion.mock.calls) {
      expect(call[0]).toMatchObject({ source: 'wikipedia' });
    }
    // The semaphore cap of 3 must never be violated.
    expect(maxInFlight).toBeLessThanOrEqual(3);
    // Wikipedia must have been called exactly once per question.
    if (mockWikiSummary) expect(mockWikiSummary).toHaveBeenCalledTimes(5);
  });
});
