/**
 * Tests for PoiService — Wikipedia-backed notable-places lookup.
 * Covers the haversine helper, URL shape, description-based filtering,
 * caching, and offline graceful-degradation.
 */

import { distanceMeters, poiService } from '../services/PoiService';

// Spyable fetch. Reset per-test.
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function wikiResponse(pages: Array<Partial<{
  pageid: number;
  title: string;
  description: string;
  coordinates: Array<{ lat: number; lon: number }>;
}>>) {
  const pagesById: Record<string, unknown> = {};
  pages.forEach((p, i) => {
    pagesById[String(p.pageid ?? i + 1)] = p;
  });
  return {
    ok: true,
    json: async () => ({ query: { pages: pagesById } }),
  };
}

describe('PoiService.distanceMeters', () => {
  it('returns ~0 for identical points', () => {
    const d = distanceMeters(37.4419, -122.143, 37.4419, -122.143);
    expect(d).toBeCloseTo(0, 3);
  });

  it('computes ~100 m between two points roughly one block apart in Palo Alto', () => {
    // Two points ~100 m apart: shift ~0.0009° in latitude (~100 m).
    const d = distanceMeters(37.4419, -122.143, 37.44280, -122.143);
    expect(d).toBeGreaterThan(90);
    expect(d).toBeLessThan(110);
  });

  it('is symmetric (A→B equals B→A)', () => {
    const a = distanceMeters(48.8566, 2.3522, 48.8584, 2.2945);
    const b = distanceMeters(48.8584, 2.2945, 48.8566, 2.3522);
    expect(a).toBeCloseTo(b, 6);
  });
});

describe('PoiService.fetchNearby', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    poiService.clearCache();
  });

  it('calls Wikipedia GeoSearch with the expected URL shape and clamped radius', async () => {
    mockFetch.mockResolvedValue(wikiResponse([]));
    await poiService.fetchNearby(37.4419, -122.143, 500, 10);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toContain('https://en.wikipedia.org/w/api.php');
    expect(url).toContain('generator=geosearch');
    expect(url).toContain('ggscoord=37.4419|-122.143');
    expect(url).toContain('ggsradius=500');
    expect(url).toContain('prop=description');
    expect(url).toContain('format=json');
  });

  it('clamps radius between 10 and 10000 meters', async () => {
    mockFetch.mockResolvedValue(wikiResponse([]));
    await poiService.fetchNearby(0, 0, 999_999, 5);
    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toContain('ggsradius=10000');

    mockFetch.mockClear();
    poiService.clearCache();
    await poiService.fetchNearby(0, 0, 1, 5);
    const url2: string = mockFetch.mock.calls[0][0];
    expect(url2).toContain('ggsradius=10');
  });

  it('filters out chain-store results', async () => {
    mockFetch.mockResolvedValue(
      wikiResponse([
        {
          pageid: 1,
          title: '7-Eleven',
          description: 'American chain of convenience stores',
          coordinates: [{ lat: 37.4419, lon: -122.143 }],
        },
        {
          pageid: 2,
          title: 'Stanford University',
          description: 'Private research university in Stanford, California',
          coordinates: [{ lat: 37.4275, lon: -122.1697 }],
        },
      ])
    );
    const results = await poiService.fetchNearby(37.4419, -122.143);
    const titles = results.map((p) => p.title);
    expect(titles).not.toContain('7-Eleven');
    expect(titles).toContain('Stanford University');
  });

  it('filters out administrative entities and highways', async () => {
    mockFetch.mockResolvedValue(
      wikiResponse([
        {
          pageid: 10,
          title: 'United States',
          description: 'Country in North America',
          coordinates: [{ lat: 37.0902, lon: -95.7129 }],
        },
        {
          pageid: 11,
          title: 'Interstate 280 (California)',
          description: 'Interstate highway in California',
          coordinates: [{ lat: 37.4419, lon: -122.143 }],
        },
        {
          pageid: 12,
          title: 'San Mateo County',
          description: 'County in California',
          coordinates: [{ lat: 37.4337, lon: -122.4015 }],
        },
        {
          pageid: 13,
          title: 'Cantor Arts Center',
          description: 'Art museum at Stanford University',
          coordinates: [{ lat: 37.4326, lon: -122.1702 }],
        },
      ])
    );
    const results = await poiService.fetchNearby(37.4419, -122.143);
    const titles = results.map((p) => p.title);
    expect(titles).not.toContain('United States');
    expect(titles).not.toContain('Interstate 280 (California)');
    expect(titles).not.toContain('San Mateo County');
    expect(titles).toContain('Cantor Arts Center');
  });

  it('keeps real attractions with descriptive short-descriptions', async () => {
    mockFetch.mockResolvedValue(
      wikiResponse([
        {
          pageid: 20,
          title: 'Stanford University',
          description: 'Private research university in Stanford, California',
          coordinates: [{ lat: 37.4275, lon: -122.1697 }],
        },
      ])
    );
    const results = await poiService.fetchNearby(37.4419, -122.143);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Stanford University');
    expect(results[0].source).toBe('wikipedia');
    expect(results[0].distanceMeters).toBeGreaterThan(0);
  });

  it('caches results so a second call with the same args does not hit fetch', async () => {
    mockFetch.mockResolvedValue(
      wikiResponse([
        {
          pageid: 30,
          title: 'Hoover Tower',
          description: 'Landmark tower at Stanford University',
          coordinates: [{ lat: 37.4275, lon: -122.1663 }],
        },
      ])
    );

    const first = await poiService.fetchNearby(37.4419, -122.143, 1000, 20);
    const second = await poiService.fetchNearby(37.4419, -122.143, 1000, 20);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('returns an empty array on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));
    const results = await poiService.fetchNearby(37.4419, -122.143);
    expect(results).toEqual([]);
  });
});
