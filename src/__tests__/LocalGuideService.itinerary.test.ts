/**
 * E1 — itinerary prompt + parser.
 */

const mockRunStream = jest.fn();
const sharedCallbacks: { current: any } = { current: null };
const lastOptions: { current: any } = { current: null };

jest.mock('../services/InferenceService', () => {
  const actual = jest.requireActual('../services/InferenceService');
  class Patched extends actual.InferenceService {
    async runInferenceStream(prompt: string, callbacks: any, options: any) {
      mockRunStream(prompt, options);
      sharedCallbacks.current = callbacks;
      lastOptions.current = options;
      return { abort: jest.fn().mockResolvedValue(undefined) };
    }
  }
  return {
    ...actual,
    InferenceService: Patched,
    inferenceService: new Patched(),
  };
});

// Mock appMode — default to offline so existing LLM-path tests stay unchanged.
const mockAppModeGet = jest.fn<'online' | 'offline', []>(() => 'offline');
jest.mock('../services/AppMode', () => ({
  appMode: {
    get: () => mockAppModeGet(),
    subscribe: jest.fn(() => () => {}),
    __resetForTest: jest.fn(),
  },
}));

// Mock wikipediaService for online-path tests.
const mockWikiSummary = jest.fn();
jest.mock('../services/WikipediaService', () => ({
  wikipediaService: {
    summary: (...args: any[]) => mockWikiSummary(...args),
    historySection: jest.fn(),
  },
}));

import { localGuideService } from '../services/LocalGuideService';
import type { Poi } from '../services/PoiService';

const paris = { latitude: 48.8566, longitude: 2.3522, placeName: 'Paris' };

function makePoi(overrides: Partial<Poi> & { title: string }): Poi {
  return {
    pageId: 1,
    latitude: 48.8566,
    longitude: 2.3522,
    distanceMeters: 100,
    source: 'wikipedia',
    ...overrides,
  };
}

describe('planItinerary', () => {
  beforeEach(() => {
    mockRunStream.mockClear();
    sharedCallbacks.current = null;
    lastOptions.current = null;
    mockAppModeGet.mockReturnValue('offline');
    mockWikiSummary.mockReset();
  });

  afterAll(async () => {
    await localGuideService.dispose();
  });

  // ── Existing LLM-path tests (offline mode) ───────────────────────────────

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

  it('runs at low priority so it yields to user-initiated queries', async () => {
    const task = localGuideService.planItinerary(paris, 4, ['Eiffel Tower']);
    const done = task.promise;
    await new Promise((r) => setImmediate(r));
    sharedCallbacks.current.onToken('1. Eiffel Tower — iconic\n');
    sharedCallbacks.current.onDone();
    await done;

    expect(lastOptions.current).toMatchObject({ priority: 'low' });
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
    const { stops } = await done;

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
    const { stops } = await done;
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
    expect(longPrompt).toContain('Pick 8 stops');
  });

  // ── New online-path tests ────────────────────────────────────────────────

  it('offline → LLM path, source=ai-offline', async () => {
    mockAppModeGet.mockReturnValue('offline');
    const task = localGuideService.planItinerary(paris, 4, [], [
      makePoi({ title: 'Eiffel Tower', articleLength: 1000 }),
    ]);
    await new Promise((r) => setImmediate(r));
    sharedCallbacks.current.onToken('1. Eiffel Tower — iconic\n');
    sharedCallbacks.current.onDone();
    const result = await task.promise;

    expect(result.source).toBe('ai-offline');
    expect(mockRunStream).toHaveBeenCalled();
  });

  it('online + nearbyPois empty → falls back to LLM, source=ai-online', async () => {
    mockAppModeGet.mockReturnValue('online');
    const task = localGuideService.planItinerary(paris, 4, ['Eiffel Tower'], []);
    await new Promise((r) => setImmediate(r));
    sharedCallbacks.current.onToken('1. Eiffel Tower — iconic\n');
    sharedCallbacks.current.onDone();
    const result = await task.promise;

    expect(result.source).toBe('ai-online');
    expect(mockRunStream).toHaveBeenCalled();
  });

  it('online + nearbyPois supplied → returns top-N by articleLength, no LLM call, source=wikipedia', async () => {
    mockAppModeGet.mockReturnValue('online');
    mockWikiSummary.mockResolvedValue(null);

    const pois = [
      makePoi({ title: 'Short', articleLength: 100 }),
      makePoi({ title: 'Long', articleLength: 5000 }),
      makePoi({ title: 'Medium', articleLength: 2000 }),
    ];

    const result = await localGuideService.planItinerary(paris, 1, [], pois).promise;

    expect(result.source).toBe('wikipedia');
    expect(mockRunStream).not.toHaveBeenCalled();
    // maxStops for 1h = 3; all 3 returned, sorted by articleLength desc.
    expect(result.stops.map((s) => s.title)).toEqual(['Long', 'Medium', 'Short']);
  });

  it('online + Poi.description present → uses it as the reason without calling Wikipedia', async () => {
    mockAppModeGet.mockReturnValue('online');

    const pois = [
      makePoi({ title: 'Eiffel Tower', description: 'famous iron lattice tower', articleLength: 1000 }),
    ];

    const result = await localGuideService.planItinerary(paris, 1, [], pois).promise;

    expect(result.source).toBe('wikipedia');
    expect(mockWikiSummary).not.toHaveBeenCalled();
    expect(result.stops[0].note).toBe('famous iron lattice tower');
  });

  it('online + Poi.description empty → calls wikipedia.summary for first-sentence fallback', async () => {
    mockAppModeGet.mockReturnValue('online');
    mockWikiSummary.mockResolvedValue({
      title: 'Louvre',
      extract: 'The Louvre is a famous museum. It was built in 1793. Very old.',
      pageUrl: 'https://en.wikipedia.org/wiki/Louvre',
    });

    const pois = [
      makePoi({ title: 'Louvre', description: '', articleLength: 3000 }),
    ];

    const result = await localGuideService.planItinerary(paris, 1, [], pois).promise;

    expect(mockWikiSummary).toHaveBeenCalledWith('Louvre');
    expect(result.stops[0].note).toBe('The Louvre is a famous museum.');
  });

  it('online concurrency cap: with 8 POIs all needing Wikipedia, max 3 in-flight at once', async () => {
    mockAppModeGet.mockReturnValue('online');

    // Track max concurrent calls.
    let inflight = 0;
    let maxInflight = 0;

    mockWikiSummary.mockImplementation(async () => {
      inflight++;
      if (inflight > maxInflight) maxInflight = inflight;
      await new Promise((r) => setTimeout(r, 10));
      inflight--;
      return { title: 'X', extract: 'Some text.', pageUrl: 'https://en.wikipedia.org' };
    });

    // 8 POIs, all without description → all need Wikipedia.
    const pois = Array.from({ length: 8 }, (_, i) =>
      makePoi({ title: `Place ${i}`, articleLength: 1000 - i })
    );

    // Full-day → maxStops = 8, so all 8 are picked.
    await localGuideService.planItinerary(paris, 8, [], pois).promise;

    // Concurrency cap is 3; maxInflight must not exceed it.
    expect(maxInflight).toBeLessThanOrEqual(3);
    expect(mockWikiSummary).toHaveBeenCalledTimes(8);
  });
});
