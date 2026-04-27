/**
 * H3 — quiz prompt + parser.
 */

const mockRunStream = jest.fn();
const sharedCallbacks: { current: any } = { current: null };

jest.mock('../services/InferenceService', () => {
  const actual = jest.requireActual('../services/InferenceService');
  class Patched extends actual.InferenceService {
    async runInferenceStream(prompt: string, callbacks: any) {
      mockRunStream(prompt);
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

describe('generateQuiz', () => {
  beforeEach(() => {
    mockRunStream.mockClear();
    sharedCallbacks.current = null;
  });

  afterAll(async () => {
    await localGuideService.dispose();
  });

  it('includes the POI list and requested question count in the prompt', async () => {
    const task = localGuideService.generateQuiz(['Eiffel Tower', 'Louvre'], 3);
    const done = task.promise;
    await new Promise((r) => setImmediate(r));
    sharedCallbacks.current.onToken('');
    sharedCallbacks.current.onDone();
    await done;
    const prompt = mockRunStream.mock.calls[0][0];
    expect(prompt).toContain('Eiffel Tower');
    expect(prompt).toContain('Louvre');
    expect(prompt).toContain('exactly 3');
  });

  it('parses well-formed Q/A/B/C/D/Correct blocks', async () => {
    const task = localGuideService.generateQuiz([], 2);
    const done = task.promise;
    await new Promise((r) => setImmediate(r));
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

  it('skips malformed blocks (missing options, missing Correct line)', async () => {
    const task = localGuideService.generateQuiz([], 3);
    const done = task.promise;
    await new Promise((r) => setImmediate(r));
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
    await new Promise((r) => setImmediate(r));
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
    await new Promise((r) => setImmediate(r));
    sharedCallbacks.current.onError('inference oom');
    await expect(done).rejects.toThrow('inference oom');
  });
});

describe('generateQuizStream', () => {
  beforeEach(() => {
    mockRunStream.mockClear();
    sharedCallbacks.current = null;
  });

  afterAll(async () => {
    await localGuideService.dispose();
  });

  // The streaming API is the load-bearing improvement over generateQuiz —
  // QuizModal needs Q1 the moment the model finishes it so the user can start
  // answering while Q2..Q5 are still generating. These tests pin down that
  // emission is per-block, not deferred to the end of the stream.

  const wellFormedFive =
    `Q: Q1?\nA: a1\nB: b1\nC: c1\nD: d1\nCorrect: A\n\n` +
    `Q: Q2?\nA: a2\nB: b2\nC: c2\nD: d2\nCorrect: B\n\n` +
    `Q: Q3?\nA: a3\nB: b3\nC: c3\nD: d3\nCorrect: C\n\n` +
    `Q: Q4?\nA: a4\nB: b4\nC: c4\nD: d4\nCorrect: D\n\n` +
    `Q: Q5?\nA: a5\nB: b5\nC: c5\nD: d5\nCorrect: A\n`;

  it('emits a question as soon as a blank line follows it (not at end of stream)', async () => {
    const onQuestion = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    localGuideService.generateQuizStream([], 5, { onQuestion, onDone, onError });
    await new Promise((r) => setImmediate(r));

    // Stream the first question, terminated by a blank line — it should fire.
    sharedCallbacks.current.onToken(
      `Q: Q1?\nA: a1\nB: b1\nC: c1\nD: d1\nCorrect: A\n\n`
    );
    expect(onQuestion).toHaveBeenCalledTimes(1);
    expect(onQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ question: 'Q1?', correctIndex: 0 }),
      0
    );
    expect(onDone).not.toHaveBeenCalled();

    // Start streaming Q2 — Q1 has already fired; Q2 won't until terminated.
    sharedCallbacks.current.onToken(`Q: Q2?\nA: a2\nB: b2\n`);
    expect(onQuestion).toHaveBeenCalledTimes(1);

    // Finish Q2 and terminate it — fires now.
    sharedCallbacks.current.onToken(`C: c2\nD: d2\nCorrect: B\n\n`);
    expect(onQuestion).toHaveBeenCalledTimes(2);
    expect(onQuestion).toHaveBeenLastCalledWith(
      expect.objectContaining({ question: 'Q2?', correctIndex: 1 }),
      1
    );
  });

  it('emits the last (un-terminated) block on done', async () => {
    const onQuestion = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    localGuideService.generateQuizStream([], 5, { onQuestion, onDone, onError });
    await new Promise((r) => setImmediate(r));

    // Note: no trailing blank line on Q5.
    sharedCallbacks.current.onToken(wellFormedFive.replace(/\n$/, ''));
    // Q1..Q4 should have fired (each terminated by blank line); Q5 hasn't yet.
    expect(onQuestion).toHaveBeenCalledTimes(4);

    sharedCallbacks.current.onDone();
    expect(onQuestion).toHaveBeenCalledTimes(5);
    expect(onQuestion).toHaveBeenLastCalledWith(
      expect.objectContaining({ question: 'Q5?', correctIndex: 0 }),
      4
    );
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0][0]).toHaveLength(5);
  });

  it('caps emissions at the requested count', async () => {
    const onQuestion = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    // Ask for 2 even though the model returns 5.
    localGuideService.generateQuizStream([], 2, { onQuestion, onDone, onError });
    await new Promise((r) => setImmediate(r));

    sharedCallbacks.current.onToken(wellFormedFive);
    sharedCallbacks.current.onDone();
    expect(onQuestion).toHaveBeenCalledTimes(2);
    expect(onDone.mock.calls[0][0]).toHaveLength(2);
  });

  it('skips malformed blocks but keeps emitting subsequent good ones', async () => {
    const onQuestion = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    localGuideService.generateQuizStream([], 5, { onQuestion, onDone, onError });
    await new Promise((r) => setImmediate(r));

    sharedCallbacks.current.onToken(
      `Q: bad\nA: a\nB: b\nCorrect: B\n\n` + // missing C/D — drop
        `Q: good?\nA: a\nB: b\nC: c\nD: d\nCorrect: A\n\n`
    );
    expect(onQuestion).toHaveBeenCalledTimes(1);
    expect(onQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ question: 'good?' }),
      0
    );
  });

  it('forwards model errors via onError', async () => {
    const onQuestion = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    localGuideService.generateQuizStream([], 5, { onQuestion, onDone, onError });
    await new Promise((r) => setImmediate(r));

    sharedCallbacks.current.onError('inference oom');
    expect(onError).toHaveBeenCalledWith('inference oom');
    expect(onDone).not.toHaveBeenCalled();
  });
});
