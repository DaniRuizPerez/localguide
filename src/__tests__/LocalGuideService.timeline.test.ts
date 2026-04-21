/**
 * H1 — timeline prompt + parser.
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

describe('buildTimeline', () => {
  beforeEach(() => {
    mockRunStream.mockClear();
    sharedCallbacks.current = null;
  });

  afterAll(async () => {
    await localGuideService.dispose();
  });

  it('emits a prompt with the POI title and location context', async () => {
    const task = localGuideService.buildTimeline('Eiffel Tower', {
      latitude: 48.8566,
      longitude: 2.3522,
      placeName: 'Paris',
    });
    const done = task.promise;
    await new Promise((r) => setImmediate(r));
    sharedCallbacks.current.onToken('1889 — opened\n');
    sharedCallbacks.current.onDone();
    await done;
    const prompt = mockRunStream.mock.calls[0][0];
    expect(prompt).toContain('Eiffel Tower');
    expect(prompt).toContain('Paris');
  });

  it('parses YEAR — event lines into structured events', async () => {
    const task = localGuideService.buildTimeline('Eiffel Tower', null);
    const done = task.promise;
    await new Promise((r) => setImmediate(r));
    sharedCallbacks.current.onToken(
      '1887 — Construction begins\n' +
      '1889 — Opened for the World Fair\n' +
      '1909 — Nearly demolished, saved as a radio antenna\n' +
      '1940 — Elevator cables cut during Nazi occupation\n'
    );
    sharedCallbacks.current.onDone();
    const events = await done;
    expect(events).toEqual([
      { year: '1887', event: 'Construction begins' },
      { year: '1889', event: 'Opened for the World Fair' },
      { year: '1909', event: 'Nearly demolished, saved as a radio antenna' },
      { year: '1940', event: 'Elevator cables cut during Nazi occupation' },
    ]);
  });

  it('accepts "century"-style periods', async () => {
    const task = localGuideService.buildTimeline('Notre-Dame', null);
    const done = task.promise;
    await new Promise((r) => setImmediate(r));
    sharedCallbacks.current.onToken(
      '12th century — Construction begins\n' +
      '1345 — Original build completed\n'
    );
    sharedCallbacks.current.onDone();
    const events = await done;
    expect(events[0]).toEqual({ year: '12th century', event: 'Construction begins' });
    expect(events[1]).toEqual({ year: '1345', event: 'Original build completed' });
  });

  it('strips bullet / numbered prefixes the model adds despite instructions', async () => {
    const task = localGuideService.buildTimeline('X', null);
    const done = task.promise;
    await new Promise((r) => setImmediate(r));
    sharedCallbacks.current.onToken(
      '- 1789 — Revolution starts\n' +
      '* 1804 — Napoleon crowns himself\n' +
      '1. 1815 — Waterloo\n'
    );
    sharedCallbacks.current.onDone();
    const events = await done;
    expect(events.map((e) => e.year)).toEqual(['1789', '1804', '1815']);
  });

  it('drops lines that are not year-like', async () => {
    const task = localGuideService.buildTimeline('X', null);
    const done = task.promise;
    await new Promise((r) => setImmediate(r));
    sharedCallbacks.current.onToken(
      'Here is the timeline you requested:\n' +
      '1889 — Opened\n' +
      'Summary — landmark status\n'
    );
    sharedCallbacks.current.onDone();
    const events = await done;
    expect(events.map((e) => e.year)).toEqual(['1889']);
  });

  it('propagates errors', async () => {
    const task = localGuideService.buildTimeline('X', null);
    const done = task.promise;
    await new Promise((r) => setImmediate(r));
    sharedCallbacks.current.onError('bad gpu');
    await expect(done).rejects.toThrow('bad gpu');
  });
});
