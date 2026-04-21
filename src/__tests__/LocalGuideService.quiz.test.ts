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
