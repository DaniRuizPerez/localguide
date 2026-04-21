/**
 * Tests for runParsedStream<T> — the helper that replaces the four copy-paste
 * stream+parse methods in LocalGuideService.
 */

const mockRunStream = jest.fn();
const sharedCallbacks: { current: any } = { current: null };
const mockAbort = jest.fn().mockResolvedValue(undefined);

jest.mock('../services/InferenceService', () => {
  const actual = jest.requireActual('../services/InferenceService');
  class Patched extends actual.InferenceService {
    async runInferenceStream(prompt: string, callbacks: any, options: any) {
      mockRunStream(prompt, options);
      sharedCallbacks.current = callbacks;
      return { abort: mockAbort };
    }
  }
  return {
    ...actual,
    InferenceService: Patched,
    inferenceService: new Patched(),
  };
});

import { runParsedStream } from '../services/streamTask';

describe('runParsedStream', () => {
  beforeEach(() => {
    mockRunStream.mockClear();
    mockAbort.mockClear();
    sharedCallbacks.current = null;
  });

  it('forwards the prompt and inference options to runInferenceStream', async () => {
    const task = runParsedStream('hello', (t) => t, { maxTokens: 42 });
    const done = task.promise;
    await new Promise((r) => setImmediate(r));
    sharedCallbacks.current.onDone();
    await done;
    expect(mockRunStream).toHaveBeenCalledWith('hello', { maxTokens: 42 });
  });

  it('accumulates token deltas and resolves with parse(fullText) on done', async () => {
    const task = runParsedStream('prompt', (t) => t.split(' '));
    const done = task.promise;
    await new Promise((r) => setImmediate(r));
    sharedCallbacks.current.onToken('one ');
    sharedCallbacks.current.onToken('two ');
    sharedCallbacks.current.onToken('three');
    sharedCallbacks.current.onDone();
    await expect(done).resolves.toEqual(['one', 'two', 'three']);
  });

  it('rejects with onError message', async () => {
    const task = runParsedStream('prompt', (t) => t);
    const done = task.promise;
    await new Promise((r) => setImmediate(r));
    sharedCallbacks.current.onError('model oom');
    await expect(done).rejects.toThrow('model oom');
  });

  it('rejects when parse() throws', async () => {
    const task = runParsedStream('prompt', () => {
      throw new Error('parser blew up');
    });
    const done = task.promise;
    await new Promise((r) => setImmediate(r));
    sharedCallbacks.current.onDone();
    await expect(done).rejects.toThrow('parser blew up');
  });

  it('abort() forwards to the captured handle', async () => {
    const task = runParsedStream('prompt', (t) => t);
    await new Promise((r) => setImmediate(r));
    await task.abort();
    expect(mockAbort).toHaveBeenCalled();
    // Resolve the still-open promise so Jest doesn't complain.
    sharedCallbacks.current.onDone();
    await task.promise.catch(() => {});
  });
});
