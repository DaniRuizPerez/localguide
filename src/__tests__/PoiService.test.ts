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
  length: number;
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

  it('requests article length so hidden-gems mode can rank by popularity', async () => {
    mockFetch.mockResolvedValue(wikiResponse([]));
    await poiService.fetchNearby(37.4419, -122.143, 1000, 10);
    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toContain('prop=description|coordinates|info');
    expect(url).toContain('inprop=length');
  });

  it('attaches articleLength when Wikipedia supplies it', async () => {
    mockFetch.mockResolvedValue(
      wikiResponse([
        {
          pageid: 40,
          title: 'Stanford University',
          description: 'Private research university',
          coordinates: [{ lat: 37.4275, lon: -122.1697 }],
          length: 500_000,
        },
      ])
    );
    const [stanford] = await poiService.fetchNearby(37.4419, -122.143);
    expect(stanford.articleLength).toBe(500_000);
  });

  it('default ranking sorts by distance ascending', async () => {
    mockFetch.mockResolvedValue(
      wikiResponse([
        {
          pageid: 50,
          title: 'Nearby Gem',
          description: 'Tiny local spot',
          coordinates: [{ lat: 37.4419, lon: -122.143 }], // 0 m away
          length: 1500,
        },
        {
          pageid: 51,
          title: 'Famous Distant Landmark',
          description: 'Landmark in Stanford',
          coordinates: [{ lat: 37.4275, lon: -122.1697 }], // ~3 km away
          length: 500_000,
        },
      ])
    );
    const results = await poiService.fetchNearby(37.4419, -122.143);
    expect(results[0].title).toBe('Nearby Gem');
  });

  it('hidden-gems ranking sorts shorter articles first', async () => {
    mockFetch.mockResolvedValue(
      wikiResponse([
        {
          pageid: 60,
          title: 'Famous Nearby Landmark',
          description: 'Major art museum',
          coordinates: [{ lat: 37.4420, lon: -122.143 }], // very close
          length: 500_000,
        },
        {
          pageid: 61,
          title: 'Obscure Nearby Landmark',
          description: 'Historic cottage',
          coordinates: [{ lat: 37.4421, lon: -122.143 }], // slightly farther
          length: 2_000,
        },
      ])
    );
    const results = await poiService.fetchNearby(37.4419, -122.143, 1000, 10, {
      hiddenGems: true,
    });
    expect(results[0].title).toBe('Obscure Nearby Landmark');
    expect(results[1].title).toBe('Famous Nearby Landmark');
  });

  it('re-ranks from cache when the hiddenGems flag flips', async () => {
    mockFetch.mockResolvedValue(
      wikiResponse([
        {
          pageid: 70,
          title: 'Obscure Spot',
          description: 'Historic marker',
          coordinates: [{ lat: 37.4420, lon: -122.143 }],
          length: 1000,
        },
        {
          pageid: 71,
          title: 'Famous Spot',
          description: 'Iconic campus building',
          coordinates: [{ lat: 37.4421, lon: -122.143 }],
          length: 200_000,
        },
      ])
    );

    // First call: default order (distance)
    const normal = await poiService.fetchNearby(37.4419, -122.143, 1000, 10);
    expect(normal[0].title).toBe('Obscure Spot');

    // Second call: hidden-gems. Should reuse the cache (no new fetch) but
    // still honor the new ordering.
    mockFetch.mockClear();
    const gems = await poiService.fetchNearby(37.4419, -122.143, 1000, 10, {
      hiddenGems: true,
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(gems[0].title).toBe('Obscure Spot'); // still first — shortest article
    expect(gems[1].title).toBe('Famous Spot');
  });
});

// ─── Offline GeoNames path ────────────────────────────────────────────────

jest.mock('../native/GeoModule', () => ({
  __esModule: true,
  default: { nearbyPlaces: jest.fn() },
  isGeoModuleAvailable: jest.fn(() => true),
}));

const mockedNearby = jest.requireMock('../native/GeoModule').default
  .nearbyPlaces as jest.Mock;
const mockedAvailable = jest.requireMock('../native/GeoModule')
  .isGeoModuleAvailable as jest.Mock;

function geoPlace(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    geonameid: 1,
    name: 'Pace Park',
    asciiname: 'Pace Park',
    admin1: 'FL',
    admin1Name: 'Florida',
    admin2: null,
    countryCode: 'US',
    countryName: 'United States',
    featureCode: 'PRK',
    population: 0,
    lat: 25.7626,
    lon: -80.1893,
    distanceMeters: 126,
    source: 'country:US',
    ...overrides,
  };
}

describe('PoiService.fetchNearby — offline GeoNames path', () => {
  beforeEach(() => {
    poiService.clearCache();
    mockFetch.mockReset();
    mockedNearby.mockReset();
    mockedAvailable.mockReturnValue(true);
  });

  it('queries GeoModule.nearbyPlaces in offline mode and maps hits to Pois', async () => {
    mockedNearby.mockResolvedValue([
      geoPlace({ geonameid: 1, name: 'Pace Park', distanceMeters: 126, featureCode: 'PRK' }),
      geoPlace({
        geonameid: 2,
        name: 'Historical Museum of Southern Florida',
        distanceMeters: 136,
        featureCode: 'MUS',
      }),
    ]);
    const results = await poiService.fetchNearby(25.7617, -80.1918, 1000, 10, {
      offline: true,
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockedNearby).toHaveBeenCalledTimes(1);
    expect(results.map((p) => p.title)).toEqual([
      'Pace Park',
      'Historical Museum of Southern Florida',
    ]);
    expect(results[0].source).toBe('geonames');
    expect(results[0].featureCode).toBe('PRK');
    expect(results[0].distanceMeters).toBe(126);
  });

  it('passes 2x the requested limit to the native side so rank/filter has slack', async () => {
    mockedNearby.mockResolvedValue([]);
    await poiService.fetchNearby(25.7617, -80.1918, 1000, 8, { offline: true });
    expect(mockedNearby).toHaveBeenCalledWith(25.7617, -80.1918, 1000, 16);
  });

  it('caps the native limit at 200 even for absurd consumer asks', async () => {
    mockedNearby.mockResolvedValue([]);
    await poiService.fetchNearby(25.7617, -80.1918, 1000, 500, { offline: true });
    const [, , , nativeLimit] = mockedNearby.mock.calls[0];
    expect(nativeLimit).toBe(200);
  });

  it('falls back to stale Wikipedia cache when GeoNames returns nothing', async () => {
    // Seed the cache with one online run.
    mockFetch.mockResolvedValue(wikiResponse([
      {
        pageid: 99,
        title: 'Stanford Cantor Arts Center',
        description: 'Art museum at Stanford University',
        coordinates: [{ lat: 37.4326, lon: -122.1702 }],
      },
    ]));
    await poiService.fetchNearby(37.4419, -122.143, 1000, 10);
    mockFetch.mockReset();

    mockedNearby.mockResolvedValue([]);
    const offline = await poiService.fetchNearby(37.4419, -122.143, 1000, 10, {
      offline: true,
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(offline.map((p) => p.title)).toEqual(['Stanford Cantor Arts Center']);
    expect(offline[0].source).toBe('wikipedia');
  });

  it('returns [] when GeoNames is empty and the cache is empty (caller falls through to LLM)', async () => {
    mockedNearby.mockResolvedValue([]);
    const results = await poiService.fetchNearby(25.7617, -80.1918, 1000, 10, {
      offline: true,
    });
    expect(results).toEqual([]);
  });

  it('skips the native call when GeoModule is not registered, returns [] cleanly', async () => {
    mockedAvailable.mockReturnValue(false);
    const results = await poiService.fetchNearby(25.7617, -80.1918, 1000, 10, {
      offline: true,
    });
    expect(mockedNearby).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it('survives a native rejection and falls through to []', async () => {
    mockedNearby.mockRejectedValue(new Error('sqlite blew up'));
    const results = await poiService.fetchNearby(25.7617, -80.1918, 1000, 10, {
      offline: true,
    });
    expect(results).toEqual([]);
  });
});
