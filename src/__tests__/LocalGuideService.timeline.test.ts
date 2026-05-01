/**
 * H1 — timeline prompt + parser.
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

// Mock appMode so tests control online/offline branch.
const mockAppModeGet = jest.fn<'online' | 'offline', []>().mockReturnValue('offline');
jest.mock('../services/AppMode', () => ({
  appMode: {
    get: () => mockAppModeGet(),
    subscribe: jest.fn().mockReturnValue(() => {}),
    __resetForTest: jest.fn(),
  },
}));

// Mock wikipediaService so tests control history section results.
const mockHistorySection = jest.fn<Promise<any>, any[]>();
jest.mock('../services/WikipediaService', () => ({
  wikipediaService: {
    historySection: (...args: any[]) => mockHistorySection(...args),
    summary: jest.fn().mockResolvedValue(null),
    summarize: jest.fn().mockResolvedValue(null),
    clearCache: jest.fn(),
  },
}));

import { localGuideService } from '../services/LocalGuideService';

// Helper: drive a pending LLM stream to completion with the given text.
async function driveLLM(text: string): Promise<void> {
  await new Promise((r) => setImmediate(r));
  sharedCallbacks.current.onToken(text);
  sharedCallbacks.current.onDone();
}

describe('buildTimeline', () => {
  beforeEach(() => {
    mockRunStream.mockClear();
    mockHistorySection.mockClear();
    sharedCallbacks.current = null;
    mockAppModeGet.mockReturnValue('offline');
    mockHistorySection.mockResolvedValue(null);
  });

  afterAll(async () => {
    await localGuideService.dispose();
  });

  // ── Existing offline tests (adapted for { events, source } shape) ──────────

  it('emits a prompt with the POI title and location context', async () => {
    const task = localGuideService.buildTimeline('Eiffel Tower', {
      latitude: 48.8566,
      longitude: 2.3522,
      placeName: 'Paris',
    });
    const done = task.promise;
    await driveLLM('1889 — opened\n');
    await done;
    const prompt = mockRunStream.mock.calls[0][0];
    expect(prompt).toContain('Eiffel Tower');
    expect(prompt).toContain('Paris');
  });

  it('parses YEAR — event lines into structured events', async () => {
    const task = localGuideService.buildTimeline('Eiffel Tower', null);
    const done = task.promise;
    await driveLLM(
      '1887 — Construction begins\n' +
      '1889 — Opened for the World Fair\n' +
      '1909 — Nearly demolished, saved as a radio antenna\n' +
      '1940 — Elevator cables cut during Nazi occupation\n'
    );
    const result = await done;
    expect(result.events).toEqual([
      { year: '1887', event: 'Construction begins' },
      { year: '1889', event: 'Opened for the World Fair' },
      { year: '1909', event: 'Nearly demolished, saved as a radio antenna' },
      { year: '1940', event: 'Elevator cables cut during Nazi occupation' },
    ]);
    expect(result.source).toBe('ai-offline');
  });

  it('accepts "century"-style periods', async () => {
    const task = localGuideService.buildTimeline('Notre-Dame', null);
    const done = task.promise;
    await driveLLM(
      '12th century — Construction begins\n' +
      '1345 — Original build completed\n'
    );
    const result = await done;
    expect(result.events[0]).toEqual({ year: '12th century', event: 'Construction begins' });
    expect(result.events[1]).toEqual({ year: '1345', event: 'Original build completed' });
  });

  it('strips bullet / numbered prefixes the model adds despite instructions', async () => {
    const task = localGuideService.buildTimeline('X', null);
    const done = task.promise;
    await driveLLM(
      '- 1789 — Revolution starts\n' +
      '* 1804 — Napoleon crowns himself\n' +
      '1. 1815 — Waterloo\n'
    );
    const result = await done;
    expect(result.events.map((e) => e.year)).toEqual(['1789', '1804', '1815']);
  });

  it('drops lines that are not year-like', async () => {
    const task = localGuideService.buildTimeline('X', null);
    const done = task.promise;
    await driveLLM(
      'Here is the timeline you requested:\n' +
      '1889 — Opened\n' +
      'Summary — landmark status\n'
    );
    const result = await done;
    expect(result.events.map((e) => e.year)).toEqual(['1889']);
  });

  it('propagates errors', async () => {
    const task = localGuideService.buildTimeline('X', null);
    const done = task.promise;
    await new Promise((r) => setImmediate(r));
    sharedCallbacks.current.onError('bad gpu');
    await expect(done).rejects.toThrow('bad gpu');
  });

  // ── New online tests ────────────────────────────────────────────────────────

  it('online + Wikipedia returns 3+ events with valid years → source=wikipedia, no LLM call', async () => {
    mockAppModeGet.mockReturnValue('online');
    mockHistorySection.mockResolvedValue([
      { year: '1889', event: 'Opened for the World Exhibition.' },
      { year: '1909', event: 'Nearly demolished but saved as a radio mast.' },
      { year: '1944', event: 'Elevators disabled during WWII occupation.' },
    ]);

    const task = localGuideService.buildTimeline('Eiffel Tower', null);
    const result = await task.promise;

    expect(result.source).toBe('wikipedia');
    expect(result.events).toHaveLength(3);
    expect(result.events[0].year).toBe('1889');
    // No LLM call made.
    expect(mockRunStream).not.toHaveBeenCalled();
  });

  it('online + Wikipedia returns < 3 events → falls back to LLM with reference, source=ai-online', async () => {
    mockAppModeGet.mockReturnValue('online');
    mockHistorySection.mockResolvedValue([
      { year: '1889', event: 'Opened.' },
      { year: '1909', event: 'Saved.' },
    ]);

    const task = localGuideService.buildTimeline('Eiffel Tower', null);
    const done = task.promise;
    await driveLLM('1887 — Construction begins\n1889 — Opened\n1909 — Saved\n');
    const result = await done;

    expect(result.source).toBe('ai-online');
    expect(mockRunStream).toHaveBeenCalledTimes(1);
    // Reference text should be injected into the prompt.
    const prompt: string = mockRunStream.mock.calls[0][0];
    expect(prompt).toContain('Reference');
    expect(prompt).toContain('1889');
  });

  it('online + Wikipedia returns null → falls back to LLM, source=ai-online', async () => {
    mockAppModeGet.mockReturnValue('online');
    mockHistorySection.mockResolvedValue(null);

    const task = localGuideService.buildTimeline('Unknown Place', null);
    const done = task.promise;
    await driveLLM('1500 — Founded\n1600 — Expanded\n1700 — Burned down\n');
    const result = await done;

    expect(result.source).toBe('ai-online');
    expect(mockRunStream).toHaveBeenCalledTimes(1);
  });

  it('online + Wikipedia returns events with one having year=null → falls back to LLM', async () => {
    mockAppModeGet.mockReturnValue('online');
    mockHistorySection.mockResolvedValue([
      { year: '1889', event: 'Opened.' },
      { year: null as any, event: 'Something happened.' },
      { year: '1944', event: 'Occupation.' },
    ]);

    const task = localGuideService.buildTimeline('Eiffel Tower', null);
    const done = task.promise;
    await driveLLM('1889 — Opened\n1909 — Saved\n1944 — Occupied\n');
    const result = await done;

    expect(result.source).toBe('ai-online');
    expect(mockRunStream).toHaveBeenCalledTimes(1);
  });

  it('online + Wikipedia returns events with one > 200 chars → falls back to LLM', async () => {
    mockAppModeGet.mockReturnValue('online');
    const longText = 'A'.repeat(201);
    mockHistorySection.mockResolvedValue([
      { year: '1889', event: 'Opened.' },
      { year: '1909', event: longText },
      { year: '1944', event: 'Occupation.' },
    ]);

    const task = localGuideService.buildTimeline('Eiffel Tower', null);
    const done = task.promise;
    await driveLLM('1889 — Opened\n1909 — Saved\n1944 — Occupied\n');
    const result = await done;

    expect(result.source).toBe('ai-online');
    expect(mockRunStream).toHaveBeenCalledTimes(1);
  });

  it('offline → LLM with source=ai-offline', async () => {
    mockAppModeGet.mockReturnValue('offline');

    const task = localGuideService.buildTimeline('Notre-Dame', null);
    const done = task.promise;
    await driveLLM('1163 — Construction begins\n1345 — Completed\n1789 — Damaged\n');
    const result = await done;

    expect(result.source).toBe('ai-offline');
    expect(mockRunStream).toHaveBeenCalledTimes(1);
    // No Wikipedia call in offline mode.
    expect(mockHistorySection).not.toHaveBeenCalled();
  });
});
