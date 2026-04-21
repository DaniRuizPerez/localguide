/**
 * E1 — itinerary prompt + parser.
 */

jest.mock('../native/LiteRTModule', () => ({ __esModule: true, default: undefined }));

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

const paris = { latitude: 48.8566, longitude: 2.3522, placeName: 'Paris' };

describe('planItinerary', () => {
  beforeEach(() => {
    mockRunStream.mockClear();
    sharedCallbacks.current = null;
  });

  afterAll(async () => {
    await localGuideService.dispose();
  });

  it('emits a prompt listing the candidate POIs and the requested duration', async () => {
    const task = localGuideService.planItinerary(paris, 2, ['Eiffel Tower', 'Louvre']);
    const done = task.promise;
    await new Promise((r) => setImmediate(r));
    sharedCallbacks.current.onToken('1. Eiffel Tower — iconic lattice\n');
    sharedCallbacks.current.onDone();
    await done;

    const prompt = mockRunStream.mock.calls[0][0];
    expect(prompt).toContain('2 hour');
    expect(prompt).toContain('Eiffel Tower');
    expect(prompt).toContain('Louvre');
    expect(prompt).toContain('Paris');
  });

  it('parses numbered Title — note lines', async () => {
    const task = localGuideService.planItinerary(paris, 4);
    const done = task.promise;
    await new Promise((r) => setImmediate(r));
    sharedCallbacks.current.onToken(
      '1. Eiffel Tower — iconic 19th-century lattice\n' +
      '2. Champ de Mars — green promenade at the tower base\n' +
      '3. Musée Rodin — sculpture garden with The Thinker\n'
    );
    sharedCallbacks.current.onDone();
    const stops = await done;

    expect(stops).toEqual([
      { title: 'Eiffel Tower', note: 'iconic 19th-century lattice' },
      { title: 'Champ de Mars', note: 'green promenade at the tower base' },
      { title: 'Musée Rodin', note: 'sculpture garden with The Thinker' },
    ]);
  });

  it('parses lines without dashes by treating the whole thing as the title', async () => {
    const task = localGuideService.planItinerary(paris, 1);
    const done = task.promise;
    await new Promise((r) => setImmediate(r));
    sharedCallbacks.current.onToken('1. Eiffel Tower\n2. Louvre\n');
    sharedCallbacks.current.onDone();
    const stops = await done;
    expect(stops.map((s) => s.title)).toEqual(['Eiffel Tower', 'Louvre']);
  });

  it('rejects on error', async () => {
    const task = localGuideService.planItinerary(paris, 1);
    const done = task.promise;
    await new Promise((r) => setImmediate(r));
    sharedCallbacks.current.onError('model died');
    await expect(done).rejects.toThrow('model died');
  });

  it('scales the requested stop count by duration', async () => {
    const shortTask = localGuideService.planItinerary(paris, 1);
    await new Promise((r) => setImmediate(r));
    sharedCallbacks.current.onToken('');
    sharedCallbacks.current.onDone();
    await shortTask.promise;
    const shortPrompt = mockRunStream.mock.calls[mockRunStream.mock.calls.length - 1][0];

    const longTask = localGuideService.planItinerary(paris, 8);
    await new Promise((r) => setImmediate(r));
    sharedCallbacks.current.onToken('');
    sharedCallbacks.current.onDone();
    await longTask.promise;
    const longPrompt = mockRunStream.mock.calls[mockRunStream.mock.calls.length - 1][0];

    expect(shortPrompt).toContain('Pick 3 stops');
    expect(longPrompt).toContain('Pick 7 stops');
  });
});
