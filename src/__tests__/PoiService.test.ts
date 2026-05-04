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

  it('ggslimit scales with radius (R1): wider radius requests more candidates', async () => {
    // rawLimit = min(500, max(limit, round(radiusMeters / 50)))
    // At radius=1000, limit=10: round(1000/50)=20 → ggslimit=20
    // At radius=10000, limit=10: round(10000/50)=200 → ggslimit=200
    // Narrow search first.
    mockFetch.mockResolvedValue(wikiResponse([]));
    await poiService.fetchNearby(37.4419, -122.143, 1000, 10);
    const urlNarrow: string = mockFetch.mock.calls[0][0];
    expect(urlNarrow).toContain('ggslimit=20');

    mockFetch.mockClear();
    poiService.clearCache();

    // Wide (10 km) search — should request 200 candidates.
    mockFetch.mockResolvedValue(wikiResponse([]));
    await poiService.fetchNearby(37.4419, -122.143, 10000, 10);
    const urlWide: string = mockFetch.mock.calls[0][0];
    expect(urlWide).toContain('ggslimit=200');

    // Verify the wide limit is strictly larger than the narrow limit.
    const narrowLimit = parseInt(urlNarrow.match(/ggslimit=(\d+)/)?.[1] ?? '0', 10);
    const wideLimit = parseInt(urlWide.match(/ggslimit=(\d+)/)?.[1] ?? '0', 10);
    expect(wideLimit).toBeGreaterThan(narrowLimit);
  });

  it('ggslimit is capped at 500 for very large rawLimit values', async () => {
    // round(50000/50)=1000; capped at Wikipedia's max of 500.
    mockFetch.mockResolvedValue(wikiResponse([]));
    await poiService.fetchNearby(37.4419, -122.143, 50000, 10);
    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toContain('ggslimit=500');
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
    // Pre-rank filter only drops categorical never-POI titles (list-of /
    // postal code / interstate prefixes). Chains, admin areas, corporate
    // pages now flow through to the ranker, which heavily demotes them via
    // descBlocklist penalty so they almost never reach the visible top N
    // — but the user-facing fix happens at ranking, not here.
    expect(titles).toContain('7-Eleven');
    expect(titles).toContain('Stanford University');
  });

  it('lets administrative entities and chains through; only hard never-POI titles are dropped', async () => {
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
    expect(titles).toContain('United States');                 // admin area — passes filter, will be demoted by ranker
    expect(titles).not.toContain('Interstate 280 (California)'); // ^interstate \d+ prefix → hard drop
    expect(titles).toContain('San Mateo County');              // admin area — passes filter, demoted by ranker
    expect(titles).toContain('Cantor Arts Center');
  });

  it('lets corporate-HQ pages through to the ranker (which demotes them via descBlocklist + corp-cat penalties)', async () => {
    mockFetch.mockResolvedValue(
      wikiResponse([
        {
          pageid: 30,
          title: 'Hewlett-Packard',
          description: 'American multinational information technology company',
          coordinates: [{ lat: 37.4136, lon: -122.1451 }],
          length: 129490,
        },
        {
          pageid: 31,
          title: 'HP Inc.',
          description: 'American multinational information technology corporation',
          coordinates: [{ lat: 37.4111, lon: -122.1476 }],
          length: 49295,
        },
        {
          pageid: 32,
          title: 'Tesla, Inc.',
          description: 'American multinational automotive manufacturer',
          coordinates: [{ lat: 37.3946, lon: -122.1500 }],
          length: 200000,
        },
        {
          pageid: 33,
          title: 'Stanford Memorial Church',
          description: 'Church on the Stanford University campus',
          coordinates: [{ lat: 37.4274, lon: -122.1697 }],
          length: 7000,
        },
      ])
    );
    const results = await poiService.fetchNearby(37.4419, -122.143);
    const titles = results.map((p) => p.title);
    // All four flow through the pre-rank filter now. The ranker handles
    // demotion via descBlocklistPenalty + the existing corp-cat penalty.
    expect(titles).toContain('Hewlett-Packard');
    expect(titles).toContain('HP Inc.');
    expect(titles).toContain('Tesla, Inc.');
    expect(titles).toContain('Stanford Memorial Church');
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

  it('does a follow-up coords fetch for pages the geosearch generator dropped, then merges (no GPS placeholder)', async () => {
    // First call (generator+geosearch): two pages, only one with coords.
    // Second call (pageids=...&prop=coordinates): supplies the missing coord.
    mockFetch
      .mockResolvedValueOnce(
        wikiResponse([
          { pageid: 100, title: 'Has Coord', description: 'Park', coordinates: [{ lat: 37.45, lon: -122.14 }], length: 5000 },
          { pageid: 200, title: 'Missing Coord', description: 'Restaurant', length: 4000 },
        ])
      )
      .mockResolvedValueOnce(
        wikiResponse([
          { pageid: 200, title: 'Missing Coord', coordinates: [{ lat: 37.46, lon: -122.15 }] },
        ])
      );

    const results = await poiService.fetchNearby(37.4419, -122.143, 5000, 10);

    // Both pages survived (the missing one was rescued by the follow-up).
    const titles = results.map((r) => r.title).sort();
    expect(titles).toEqual(['Has Coord', 'Missing Coord']);

    // Neither lat is the GPS placeholder.
    const missing = results.find((r) => r.title === 'Missing Coord')!;
    expect(missing.latitude).toBeCloseTo(37.46);
    expect(missing.longitude).toBeCloseTo(-122.15);
    expect(missing.distanceMeters).toBeGreaterThan(500);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toContain('pageids=200');
    expect(mockFetch.mock.calls[1][0]).toContain('prop=coordinates');
  });

  it('drops pages still missing coords after the enrichment call (no fake 0 m distances)', async () => {
    mockFetch
      .mockResolvedValueOnce(
        wikiResponse([
          { pageid: 300, title: 'No Coord', description: 'Park', length: 1000 },
        ])
      )
      // Follow-up returns nothing useful.
      .mockResolvedValueOnce(wikiResponse([]));

    const results = await poiService.fetchNearby(37.4419, -122.143, 5000, 10);
    expect(results.map((r) => r.title)).toEqual([]);
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

// ─── Streaming path (perceived-latency optimization) ──────────────────────

describe('PoiService.fetchNearbyStreaming', () => {
  beforeEach(() => {
    poiService.clearCache();
    mockFetch.mockReset();
    mockedNearby.mockReset();
    mockedAvailable.mockReturnValue(true);
  });

  it('emits the GeoNames result as a partial before Wikipedia resolves, then resolves with Wikipedia', async () => {
    // GeoNames lands first (resolves synchronously after a microtask),
    // Wikipedia resolves on a deferred timer to simulate a slower network.
    mockedNearby.mockResolvedValue([
      geoPlace({ geonameid: 9001, name: 'Local Park', lat: 37.4419, lon: -122.143, distanceMeters: 50 }),
    ]);
    let resolveWiki: ((v: unknown) => void) | null = null;
    mockFetch.mockReturnValue(
      new Promise((resolve) => {
        resolveWiki = resolve;
      })
    );

    const partials: Array<{ stage: string; titles: string[] }> = [];
    const finalP = poiService.fetchNearbyStreaming(
      37.4419,
      -122.143,
      1000,
      10,
      {},
      {
        onPartial: (pois, stage) => {
          partials.push({ stage, titles: pois.map((p) => p.title) });
        },
      }
    );

    // Flush the GeoNames microtask so its onPartial fires.
    await Promise.resolve();
    await Promise.resolve();
    expect(partials.length).toBeGreaterThanOrEqual(1);
    expect(partials[0].stage).toBe('geonames');
    expect(partials[0].titles).toEqual(['Local Park']);

    // Now resolve Wikipedia with the canonical list.
    resolveWiki!(
      wikiResponse([
        {
          pageid: 12345,
          title: 'Cantor Arts Center',
          description: 'Art museum at Stanford University',
          coordinates: [{ lat: 37.4326, lon: -122.1702 }],
        },
      ])
    );
    const finalList = await finalP;
    expect(finalList.map((p) => p.title)).toEqual(['Cantor Arts Center']);
    expect(finalList[0].source).toBe('wikipedia');
  });

  it('emits a partial from a stale cache entry before refetching', async () => {
    // Seed the cache, then expire it by manually invoking with a stale TTL.
    mockFetch.mockResolvedValueOnce(
      wikiResponse([
        {
          pageid: 1,
          title: 'Old Stale Entry',
          description: 'Historic landmark',
          coordinates: [{ lat: 37.4419, lon: -122.143 }],
        },
      ])
    );
    await poiService.fetchNearby(37.4419, -122.143, 1000, 10);

    // Force the cache to be stale by jumping time forward.
    const realNow = Date.now;
    Date.now = () => realNow() + 6 * 60 * 1000;

    try {
      mockedNearby.mockResolvedValue([]);
      mockFetch.mockResolvedValueOnce(
        wikiResponse([
          {
            pageid: 2,
            title: 'Fresh Entry',
            description: 'Newly relevant landmark',
            coordinates: [{ lat: 37.4419, lon: -122.143 }],
          },
        ])
      );

      const partials: string[][] = [];
      const finalList = await poiService.fetchNearbyStreaming(
        37.4419,
        -122.143,
        1000,
        10,
        {},
        {
          onPartial: (pois) => partials.push(pois.map((p) => p.title)),
        }
      );

      expect(partials).toContainEqual(['Old Stale Entry']);
      expect(finalList.map((p) => p.title)).toEqual(['Fresh Entry']);
    } finally {
      Date.now = realNow;
    }
  });

  it('skips streaming partials when a fresh cache entry is available', async () => {
    mockFetch.mockResolvedValue(
      wikiResponse([
        {
          pageid: 1,
          title: 'Cached Entry',
          description: 'Historic landmark',
          coordinates: [{ lat: 37.4419, lon: -122.143 }],
        },
      ])
    );
    await poiService.fetchNearby(37.4419, -122.143, 1000, 10);
    mockFetch.mockClear();

    const partials: string[][] = [];
    const result = await poiService.fetchNearbyStreaming(
      37.4419,
      -122.143,
      1000,
      10,
      {},
      {
        onPartial: (pois) => partials.push(pois.map((p) => p.title)),
      }
    );
    expect(partials).toEqual([]); // fresh cache → no stream needed
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.map((p) => p.title)).toEqual(['Cached Entry']);
  });

  it('falls through to the offline fetchNearby path when offline:true', async () => {
    mockedNearby.mockResolvedValue([
      geoPlace({ geonameid: 1, name: 'Offline Place', distanceMeters: 100 }),
    ]);
    const result = await poiService.fetchNearbyStreaming(
      25.76,
      -80.19,
      1000,
      10,
      { offline: true }
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.map((p) => p.title)).toEqual(['Offline Place']);
    expect(result[0].source).toBe('geonames');
  });
});
