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

  it('parses common Gemma drift: Question 1 / Answer / bold markers', async () => {
    // Real-world resilience: the strict prompt asks for "Q:" and "Correct:",
    // but the small-model variant occasionally emits "Question 1:" headers,
    // markdown-bolded markers, and "Answer:" instead of "Correct:".
    const task = localGuideService.generateQuiz([], 3);
    const done = task.promise;
    await new Promise((r) => setImmediate(r));
    sharedCallbacks.current.onToken(
      `**Question 1:** What is the tallest tower?\n` +
      `A) Eiffel\n` +
      `B) Burj Khalifa\n` +
      `C) Tokyo Skytree\n` +
      `D) CN Tower\n` +
      `Answer: B\n` +
      `**Question 2:** Capital of France?\n` +
      `A) Lyon\n` +
      `B) Marseille\n` +
      `C) Paris\n` +
      `D) Nice\n` +
      `Answer: C\n`
    );
    sharedCallbacks.current.onDone();
    const quiz = await done;
    expect(quiz).toHaveLength(2);
    expect(quiz[0].question).toBe('What is the tallest tower?');
    expect(quiz[0].correctIndex).toBe(1);
    expect(quiz[1].question).toBe('Capital of France?');
    expect(quiz[1].correctIndex).toBe(2);
  });

  it('parses numbered-list quiz format (1. / 2. / 3.)', async () => {
    const task = localGuideService.generateQuiz([], 2);
    const done = task.promise;
    await new Promise((r) => setImmediate(r));
    sharedCallbacks.current.onToken(
      `1. Who painted the Mona Lisa?\n` +
      `A. Picasso\n` +
      `B. Da Vinci\n` +
      `C. Van Gogh\n` +
      `D. Rembrandt\n` +
      `Correct: B\n\n` +
      `2. What language is spoken in Brazil?\n` +
      `A. Spanish\n` +
      `B. English\n` +
      `C. Portuguese\n` +
      `D. French\n` +
      `Correct: C\n`
    );
    sharedCallbacks.current.onDone();
    const quiz = await done;
    expect(quiz).toHaveLength(2);
    expect(quiz[0].question).toBe('Who painted the Mona Lisa?');
    expect(quiz[1].question).toBe('What language is spoken in Brazil?');
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

  // The streaming API issues N sequential single-question inferences because
  // Gemma 4 E2B reliably stops after producing one well-formed Q/A/B/C/D
  // block. Each call's prompt includes the previously-asked question texts so
  // the set stays varied. These tests pin down that contract.

  const oneQuestion = (q: string, opts: [string, string, string, string], correct: string) =>
    `Q: ${q}\nA: ${opts[0]}\nB: ${opts[1]}\nC: ${opts[2]}\nD: ${opts[3]}\nCorrect: ${correct}\n`;

  // Drive one round of the per-question inference: feed text for the current
  // call, fire onDone, and wait for the service to start the next call.
  const completeOne = async (text: string) => {
    sharedCallbacks.current.onToken(text);
    sharedCallbacks.current.onDone();
    await new Promise((r) => setImmediate(r));
  };

  it('emits each question as the per-call inference completes', async () => {
    const onQuestion = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    localGuideService.generateQuizStream([], 3, { onQuestion, onDone, onError });
    await new Promise((r) => setImmediate(r));

    await completeOne(oneQuestion('Q1?', ['a1', 'b1', 'c1', 'd1'], 'A'));
    expect(onQuestion).toHaveBeenCalledTimes(1);
    expect(onQuestion).toHaveBeenLastCalledWith(
      expect.objectContaining({ question: 'Q1?', correctIndex: 0 }),
      0
    );

    await completeOne(oneQuestion('Q2?', ['a2', 'b2', 'c2', 'd2'], 'B'));
    expect(onQuestion).toHaveBeenCalledTimes(2);
    expect(onQuestion).toHaveBeenLastCalledWith(
      expect.objectContaining({ question: 'Q2?', correctIndex: 1 }),
      1
    );

    await completeOne(oneQuestion('Q3?', ['a3', 'b3', 'c3', 'd3'], 'C'));
    expect(onQuestion).toHaveBeenCalledTimes(3);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0][0]).toHaveLength(3);
  });

  it('passes already-asked questions to follow-up calls so the model can avoid repeats', async () => {
    const onQuestion = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    localGuideService.generateQuizStream(['Eiffel Tower'], 2, {
      onQuestion,
      onDone,
      onError,
    });
    await new Promise((r) => setImmediate(r));

    // First call: no prior questions yet.
    expect(mockRunStream).toHaveBeenCalledTimes(1);
    expect(mockRunStream.mock.calls[0][0]).toContain('Eiffel Tower');
    expect(mockRunStream.mock.calls[0][0]).not.toContain('Already-asked');

    await completeOne(oneQuestion('When was the tower built?', ['1789', '1889', '1945', '1900'], 'B'));

    // Second call: the prompt includes the just-asked question.
    expect(mockRunStream).toHaveBeenCalledTimes(2);
    expect(mockRunStream.mock.calls[1][0]).toContain('Already-asked');
    expect(mockRunStream.mock.calls[1][0]).toContain('When was the tower built?');
  });

  it('caps emissions at the requested count and stops issuing further calls', async () => {
    const onQuestion = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    localGuideService.generateQuizStream([], 2, { onQuestion, onDone, onError });
    await new Promise((r) => setImmediate(r));

    await completeOne(oneQuestion('Q1?', ['a', 'b', 'c', 'd'], 'A'));
    await completeOne(oneQuestion('Q2?', ['a', 'b', 'c', 'd'], 'B'));

    expect(onQuestion).toHaveBeenCalledTimes(2);
    expect(mockRunStream).toHaveBeenCalledTimes(2);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0][0]).toHaveLength(2);
  });

  it('skips a malformed reply but continues with the next call', async () => {
    const onQuestion = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    localGuideService.generateQuizStream([], 2, { onQuestion, onDone, onError });
    await new Promise((r) => setImmediate(r));

    // First call returns a malformed block (missing C/D). The service
    // retries the same slot once (Gemma 4 E2B sometimes produces a bad
    // sample that a single retry clears) — that retry is also malformed
    // here, so the slot is given up and the service moves to the next.
    await completeOne(`Q: bad\nA: a\nB: b\nCorrect: B\n`);
    expect(onQuestion).toHaveBeenCalledTimes(0);
    expect(mockRunStream).toHaveBeenCalledTimes(2);
    await completeOne(`Q: also bad\nA: a\nB: b\nCorrect: B\n`);
    expect(onQuestion).toHaveBeenCalledTimes(0);
    expect(mockRunStream).toHaveBeenCalledTimes(3);

    await completeOne(oneQuestion('good?', ['a', 'b', 'c', 'd'], 'A'));
    expect(onQuestion).toHaveBeenCalledTimes(1);
    expect(onQuestion).toHaveBeenLastCalledWith(
      expect.objectContaining({ question: 'good?' }),
      0
    );
    expect(onDone).toHaveBeenCalledTimes(1);
    // emitted only contains the good one; total length reflects what the
    // service actually parsed (1), even though count was 2.
    expect(onDone.mock.calls[0][0]).toHaveLength(1);
  });

  it('forwards model errors via onError and stops further calls', async () => {
    const onQuestion = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    localGuideService.generateQuizStream([], 5, { onQuestion, onDone, onError });
    await new Promise((r) => setImmediate(r));

    sharedCallbacks.current.onError('inference oom');
    await new Promise((r) => setImmediate(r));

    expect(onError).toHaveBeenCalledWith('inference oom');
    expect(onDone).not.toHaveBeenCalled();
    // No follow-up call is issued after an error.
    expect(mockRunStream).toHaveBeenCalledTimes(1);
  });
});
