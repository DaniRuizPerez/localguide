/**
 * Tests for listNearbyPlaces / parsePlaceList:
 *   - markdown bold (**name**) is stripped from returned names
 *   - the city from GPSContext.placeName is embedded in the prompt
 */

interface CallRecord {
  prompt: string;
  callbacks: any;
}

const callQueue: CallRecord[] = [];
const mockRunStream = jest.fn((prompt: string, callbacks: any) => {
  callQueue.push({ prompt, callbacks });
});

jest.mock('../services/InferenceService', () => {
  const actual = jest.requireActual('../services/InferenceService');
  class Patched extends actual.InferenceService {
    async runInferenceStream(prompt: string, callbacks: any) {
      mockRunStream(prompt, callbacks);
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

function flushMicrotasks() {
  return new Promise((r) => setImmediate(r));
}

/** Drive the most-recent stream call with `text`, then close it. */
async function completeWith(text: string) {
  await flushMicrotasks();
  const call = callQueue[callQueue.length - 1];
  call.callbacks.onToken(text);
  call.callbacks.onDone();
  await flushMicrotasks();
}

beforeEach(() => {
  mockRunStream.mockClear();
  callQueue.length = 0;
});

afterAll(async () => {
  await localGuideService.dispose();
});

describe('parsePlaceList — markdown bold stripping', () => {
  it('strips **bold** wrapping from place names', async () => {
    const task = localGuideService.listNearbyPlaces({ latitude: 37.44, longitude: -122.14 });
    const donePromise = task.promise;
    await completeWith(
      '**Rodin Sculpture Garden**\n' +
      '**Stanford Memorial Church**\n' +
      '**Hoover Tower**\n'
    );
    const names = await donePromise;
    expect(names).toEqual([
      'Rodin Sculpture Garden',
      'Stanford Memorial Church',
      'Hoover Tower',
    ]);
  });

  it('strips *single-star* and __double-underscore__ wrapping', async () => {
    const task = localGuideService.listNearbyPlaces({ latitude: 37.44, longitude: -122.14 });
    const donePromise = task.promise;
    await completeWith('*City Hall*\n__Central Park__\n');
    const names = await donePromise;
    expect(names).toEqual(['City Hall', 'Central Park']);
  });

  it('leaves plain names unchanged', async () => {
    const task = localGuideService.listNearbyPlaces({ latitude: 37.44, longitude: -122.14 });
    const donePromise = task.promise;
    await completeWith('Palo Alto Art Center\nStanford University\n');
    const names = await donePromise;
    expect(names).toEqual(['Palo Alto Art Center', 'Stanford University']);
  });

  it('rejects digit-only / phone-number / coordinate-style garbage', async () => {
    // The 1B model occasionally emits sequences like "125-677-6666" or
    // "37.4232, -122.1494" when it hits the token cap mid-thought. Without
    // a letter-presence check, parsePlaceList passed those straight through
    // and the home screen rendered them as place names.
    const task = localGuideService.listNearbyPlaces({ latitude: 37.44, longitude: -122.14 });
    const donePromise = task.promise;
    await completeWith(
      '125-677-6666\n' +
      '37.4232, -122.1494\n' +
      '12345\n' +
      'Stanford University\n'
    );
    const names = await donePromise;
    expect(names).toEqual(['Stanford University']);
  });
});

describe('listNearbyPlaces — city grounding in prompt', () => {
  it('includes the city name from GPSContext.placeName in the prompt', async () => {
    const location = {
      latitude: 37.4419,
      longitude: -122.143,
      placeName: 'Palo Alto, California',
    };
    const task = localGuideService.listNearbyPlaces(location, 1000);
    const donePromise = task.promise;
    await completeWith('Rodin Sculpture Garden\n');
    await donePromise;
    const [prompt] = mockRunStream.mock.calls[mockRunStream.mock.calls.length - 1];
    expect(prompt).toContain('IN Palo Alto, California');
  });

  it('omits the city phrase when placeName is absent', async () => {
    const location = { latitude: 37.4419, longitude: -122.143 };
    const task = localGuideService.listNearbyPlaces(location, 1000);
    const donePromise = task.promise;
    await completeWith('Rodin Sculpture Garden\n');
    await donePromise;
    const [prompt] = mockRunStream.mock.calls[mockRunStream.mock.calls.length - 1];
    // Without a placeName the city phrase should not appear mid-sentence.
    expect(prompt).not.toMatch(/TOURIST-WORTHY places IN /);
  });
});
