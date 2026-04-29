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

import { localGuideService } from '../services/LocalGuideService';

beforeEach(() => {
  mockRunStream.mockClear();
  callQueue.length = 0;
  sharedCallbacks.current = null;
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

    // The 1st prompt has no avoid list; the 2nd must list Q1.
    const firstPrompt: string = mockRunStream.mock.calls[0][0];
    expect(firstPrompt).not.toContain('Already asked');

    await completeNextCallWith(
      `Q: What river runs near Palo Alto?\n` +
        `A: Hudson\n` +
        `B: Seine\n` +
        `C: San Francisquito Creek\n` +
        `D: Thames\n` +
        `Correct: C\n`
    );
    const secondPrompt: string = mockRunStream.mock.calls[1][0];
    expect(secondPrompt).toContain('Already asked');
    expect(secondPrompt).toContain('When was Stanford University founded?');
    expect(secondPrompt).toContain('Palo Alto, California');

    await completeNextCallWith(
      `Q: What is Palo Alto known for?\n` +
        `A: Tech industry\n` +
        `B: Olive oil\n` +
        `C: Wine\n` +
        `D: Coal\n` +
        `Correct: A\n`
    );
    const thirdPrompt: string = mockRunStream.mock.calls[2][0];
    expect(thirdPrompt).toContain('When was Stanford University founded?');
    expect(thirdPrompt).toContain('What river runs near Palo Alto?');
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
  });

  it('caps dedupe retries and finishes early with what we have', async () => {
    const onQuestion = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    localGuideService.generateQuizStream(
      [],
      3,
      { onQuestion, onDone, onError }
    );

    // Q1: accept.
    await completeNextCallWith(
      `Q: First question?\nA: a\nB: b\nC: c\nD: d\nCorrect: A\n`
    );
    // Q2 slot: every attempt is a duplicate of Q1. Initial + 2 retries = 3.
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
    // After exhausting retries we stop the run rather than burning more
    // tokens. onDone fires with whatever we collected.
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
