/**
 * Tests for MapsService — Google Directions walking-time wrapper.
 * Covers: happy path, no-key guard, ZERO_RESULTS, network failure,
 * LRU cache hit, abort signal, and the walkingTimes convenience wrapper.
 */

import { mapsService } from '../services/MapsService';

// ─── Mock expo-constants ────────────────────────────────────────────────────

let mockApiKey: string | null = 'TEST_KEY_123';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockApiKey !== null
        ? { extra: { googleMapsApiKey: mockApiKey } }
        : { extra: { googleMapsApiKey: '' } };
    },
  },
}));

// ─── Mock global.fetch ──────────────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FROM = { lat: 37.7749, lon: -122.4194 };
const TO   = { lat: 37.7849, lon: -122.4094 };

/** Build a well-formed Directions API success response. */
function directionsOk(durationSeconds: number) {
  return {
    ok: true,
    json: async () => ({
      status: 'OK',
      routes: [{ legs: [{ duration: { value: durationSeconds } }] }],
    }),
  };
}

function directionsStatus(status: string) {
  return {
    ok: true,
    json: async () => ({ status, routes: [] }),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockFetch.mockReset();
  mapsService.clearCache();
  mockApiKey = 'TEST_KEY_123';
});

// 1. Configured + happy path returns minutes.
describe('walkingTime — happy path', () => {
  it('returns duration in minutes (rounded) when the API key is set and the response is OK', async () => {
    mockFetch.mockResolvedValue(directionsOk(754)); // 12.56 min → rounds to 13
    const result = await mapsService.walkingTime(FROM, TO);
    expect(result).toBe(13);
  });

  it('calls the Directions endpoint with origin, destination, mode=walking, and the API key', async () => {
    mockFetch.mockResolvedValue(directionsOk(600));
    await mapsService.walkingTime(FROM, TO);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toContain('maps.googleapis.com/maps/api/directions/json');
    expect(url).toContain(`origin=${FROM.lat},${FROM.lon}`);
    expect(url).toContain(`destination=${TO.lat},${TO.lon}`);
    expect(url).toContain('mode=walking');
    expect(url).toContain('key=TEST_KEY_123');
  });

  it('rounds 30 seconds up to 1 minute', async () => {
    mockFetch.mockResolvedValue(directionsOk(90)); // 1.5 min → rounds to 2
    expect(await mapsService.walkingTime(FROM, TO)).toBe(2);
  });
});

// 2. No API key configured returns null without calling fetch.
describe('walkingTime — no API key', () => {
  it('returns null immediately without calling fetch when the key is empty', async () => {
    mockApiKey = null;
    const result = await mapsService.walkingTime(FROM, TO);
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('isConfigured() returns false when key is absent', () => {
    mockApiKey = null;
    expect(mapsService.isConfigured()).toBe(false);
  });

  it('isConfigured() returns true when key is present', () => {
    mockApiKey = 'MY_KEY';
    expect(mapsService.isConfigured()).toBe(true);
  });
});

// 3. ZERO_RESULTS (and other non-OK statuses) return null.
describe('walkingTime — non-OK API status', () => {
  it('returns null when status is ZERO_RESULTS', async () => {
    mockFetch.mockResolvedValue(directionsStatus('ZERO_RESULTS'));
    expect(await mapsService.walkingTime(FROM, TO)).toBeNull();
  });

  it('returns null when status is NOT_FOUND', async () => {
    mockFetch.mockResolvedValue(directionsStatus('NOT_FOUND'));
    expect(await mapsService.walkingTime(FROM, TO)).toBeNull();
  });

  it('returns null when HTTP response is not OK', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    expect(await mapsService.walkingTime(FROM, TO)).toBeNull();
  });
});

// 4. Fetch rejects (network error / timeout) returns null.
describe('walkingTime — fetch failure', () => {
  it('returns null when fetch rejects with a network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network request failed'));
    expect(await mapsService.walkingTime(FROM, TO)).toBeNull();
  });

  it('returns null when fetch rejects with an abort error', async () => {
    mockFetch.mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    expect(await mapsService.walkingTime(FROM, TO)).toBeNull();
  });
});

// 5. Cache hit returns value without re-fetching.
describe('walkingTime — LRU cache', () => {
  it('returns cached value on the second call without hitting fetch again', async () => {
    mockFetch.mockResolvedValue(directionsOk(480)); // 8 min
    const first = await mapsService.walkingTime(FROM, TO);
    const second = await mapsService.walkingTime(FROM, TO);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(first).toBe(8);
    expect(second).toBe(8);
  });

  it('does not reuse the cache for a different destination', async () => {
    mockFetch.mockResolvedValue(directionsOk(300));
    await mapsService.walkingTime(FROM, TO);
    await mapsService.walkingTime(FROM, { lat: 37.8044, lon: -122.2712 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('clearCache() causes the next call to re-fetch', async () => {
    mockFetch.mockResolvedValue(directionsOk(300));
    await mapsService.walkingTime(FROM, TO);
    mapsService.clearCache();
    await mapsService.walkingTime(FROM, TO);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// 6. Abort signal: caller abort propagates, returns null.
describe('walkingTime — abort signal', () => {
  it('returns null when the caller AbortSignal fires during fetch', async () => {
    const ac = new AbortController();
    // Simulate a fetch that rejects with AbortError when the signal fires.
    mockFetch.mockImplementation((_url: string, opts: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        if (opts?.signal?.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        opts?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });

    const resultP = mapsService.walkingTime(FROM, TO, { signal: ac.signal });
    ac.abort();
    expect(await resultP).toBeNull();
  });
});

// 7. walkingTimes returns mixed pass/null per element.
describe('walkingTimes', () => {
  it('returns an array matching each to-coordinate — some succeed, some null', async () => {
    const to1 = { lat: 37.7849, lon: -122.4094 };
    const to2 = { lat: 37.8044, lon: -122.2712 };
    const to3 = { lat: 37.3861, lon: -122.0839 };

    mockFetch
      .mockResolvedValueOnce(directionsOk(300))        // to1 → 5 min
      .mockResolvedValueOnce(directionsStatus('ZERO_RESULTS')) // to2 → null
      .mockResolvedValueOnce(directionsOk(720));        // to3 → 12 min

    const results = await mapsService.walkingTimes(FROM, [to1, to2, to3]);
    expect(results).toEqual([5, null, 12]);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('returns an array of nulls when the API key is not configured', async () => {
    mockApiKey = null;
    const results = await mapsService.walkingTimes(FROM, [TO, TO]);
    expect(results).toEqual([null, null]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns an empty array for empty tos list', async () => {
    const results = await mapsService.walkingTimes(FROM, []);
    expect(results).toEqual([]);
  });
});
