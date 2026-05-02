import {
  rankByInterestOnline,
  rankByInterestOffline,
  rankByInterestSync,
} from '../services/poiRanking';
import type { Poi } from '../services/PoiService';
import type { GPSContext } from '../services/InferenceService';
import type { WikipediaSignals } from '../services/wikipediaSignals';

const gps: GPSContext = {
  latitude: 37.4419,
  longitude: -122.143,
  accuracy: 10,
  placeName: 'Palo Alto',
};

function poi(p: Partial<Poi> & { pageId: number; title: string; lat: number; lon: number }): Poi {
  return {
    pageId: p.pageId,
    title: p.title,
    latitude: p.lat,
    longitude: p.lon,
    distanceMeters: 0,
    source: p.source ?? 'wikipedia',
    articleLength: p.articleLength,
    description: p.description,
    featureCode: p.featureCode,
  };
}

function sig(partial: Partial<WikipediaSignals>): WikipediaSignals {
  return {
    categories: partial.categories ?? [],
    langlinkCount: partial.langlinkCount ?? 0,
    pageviews60d: partial.pageviews60d ?? 0,
  };
}

// Paint-bug fixture: HP / HP Inc. dominate length sort but tank on the
// composite ranker. Stanford Memorial Church + Hoover Institution win.
const PALO_ALTO_POIS: Poi[] = [
  poi({ pageId: 1, title: 'Hewlett-Packard', lat: 37.4136, lon: -122.1451, articleLength: 129490, description: 'American multinational information technology company' }),
  poi({ pageId: 2, title: 'HP Inc.', lat: 37.4111, lon: -122.1476, articleLength: 49295, description: 'American multinational information technology corporation' }),
  poi({ pageId: 3, title: 'Stanford Memorial Church', lat: 37.4274, lon: -122.1697, articleLength: 7000, description: 'Church on the Stanford University campus' }),
  poi({ pageId: 4, title: 'Hoover Institution', lat: 37.4275, lon: -122.1664, articleLength: 18000, description: 'Public policy think tank' }),
  poi({ pageId: 5, title: 'Cantor Arts Center', lat: 37.4326, lon: -122.1702, articleLength: 11000, description: 'Art museum at Stanford University' }),
  poi({ pageId: 6, title: 'Stanford University', lat: 37.4275, lon: -122.1697, articleLength: 250000, description: 'Private research university in Stanford, California' }),
  poi({ pageId: 7, title: 'Mayfield Brewery', lat: 37.4272, lon: -122.1436, articleLength: 6531, description: 'Brewery in Mayfield, California' }),
  poi({ pageId: 8, title: 'Matadero Creek', lat: 37.4242, lon: -122.1336, articleLength: 26654, description: 'Stream originating in California' }),
];

const PALO_ALTO_SIGNALS = new Map<number, WikipediaSignals>([
  [1, sig({ categories: ['category:companies based in palo alto, california', 'category:technology companies established in 1939'], langlinkCount: 90, pageviews60d: 80000 })],
  [2, sig({ categories: ['category:companies based in palo alto, california', 'category:technology companies'], langlinkCount: 50, pageviews60d: 40000 })],
  [3, sig({ categories: ['category:churches in santa clara county, california', 'category:stanford university buildings', 'category:national register of historic places in california'], langlinkCount: 12, pageviews60d: 25000 })],
  [4, sig({ categories: ['category:tourist attractions in santa clara county, california', 'category:stanford university research institutes'], langlinkCount: 18, pageviews60d: 30000 })],
  [5, sig({ categories: ['category:art museums and galleries in california', 'category:museums in santa clara county, california'], langlinkCount: 8, pageviews60d: 15000 })],
  [6, sig({ categories: ['category:stanford university', 'category:private universities and colleges in california'], langlinkCount: 130, pageviews60d: 200000 })],
  [7, sig({ categories: ['category:defunct breweries of the united states'], langlinkCount: 1, pageviews60d: 200 })],
  [8, sig({ categories: ['category:rivers of santa clara county, california'], langlinkCount: 2, pageviews60d: 800 })],
]);

describe('rankByInterestOnline (composite ranker)', () => {
  it('drops HP / HP Inc. out of the top 5 and surfaces Stanford Memorial Church + Hoover Institution', () => {
    const ranked = rankByInterestOnline(PALO_ALTO_POIS, gps, PALO_ALTO_SIGNALS, { radiusMeters: 5000 });
    const top5 = ranked.slice(0, 5).map((p) => p.title);
    expect(top5).toContain('Stanford Memorial Church');
    expect(top5).toContain('Hoover Institution');
    // HP / HP Inc. carry the corp-blocklist penalty and should fall out of the top 5.
    expect(top5).not.toContain('Hewlett-Packard');
    expect(top5).not.toContain('HP Inc.');
  });

  it('does not let Stanford University (huge article, huge pageviews) crowd out the smaller landmarks', () => {
    const ranked = rankByInterestOnline(PALO_ALTO_POIS, gps, PALO_ALTO_SIGNALS, { radiusMeters: 5000 });
    // Stanford University will rank high (pageviews 200k) but at least one
    // smaller tourist-allowlist landmark should also be in top 3.
    const top3 = ranked.slice(0, 3).map((p) => p.title);
    const landmarks = ['Stanford Memorial Church', 'Hoover Institution', 'Cantor Arts Center'];
    expect(landmarks.some((t) => top3.includes(t))).toBe(true);
  });

  it('hidden-gems mode: lesser-known landmarks beat famous ones', () => {
    const ranked = rankByInterestOnline(PALO_ALTO_POIS, gps, PALO_ALTO_SIGNALS, {
      hiddenGems: true,
      radiusMeters: 5000,
    });
    const cantorIdx = ranked.findIndex((p) => p.title === 'Cantor Arts Center');
    const stanfordIdx = ranked.findIndex((p) => p.title === 'Stanford University');
    expect(cantorIdx).toBeGreaterThanOrEqual(0);
    // In hidden-gems mode Cantor (less famous, smaller article, lower pv) should
    // outrank Stanford University.
    expect(cantorIdx).toBeLessThan(stanfordIdx);
  });

  it('confidence gate: if fewer than 3 candidates have pageviews, falls back to length sort', () => {
    const sparseSignals = new Map<number, WikipediaSignals>([
      [3, sig({ pageviews60d: 25000 })],
      [4, sig({ pageviews60d: 30000 })],
    ]);
    const ranked = rankByInterestOnline(PALO_ALTO_POIS, gps, sparseSignals, { radiusMeters: 5000 });
    // Length-sort fallback puts Stanford University (250k) at top.
    expect(ranked[0].title).toBe('Stanford University');
  });

  it('empty signals map → falls back to length sort, no crash', () => {
    const ranked = rankByInterestOnline(PALO_ALTO_POIS, gps, new Map(), { radiusMeters: 5000 });
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].title).toBe('Stanford University');
  });

  it('adaptive distance decay: wide search keeps farther landmarks alive', () => {
    // Same POI set, two different radii.
    const farLandmark = poi({ pageId: 99, title: 'Far Famous Park', lat: 37.50, lon: -122.05, articleLength: 30000, description: 'Park in California' });
    const farSignals = new Map(PALO_ALTO_SIGNALS);
    farSignals.set(99, sig({ categories: ['category:parks in santa clara county, california'], langlinkCount: 10, pageviews60d: 20000 }));
    const inputs = [...PALO_ALTO_POIS, farLandmark];

    const tightRanked = rankByInterestOnline(inputs, gps, farSignals, { radiusMeters: 1000 });
    const wideRanked = rankByInterestOnline(inputs, gps, farSignals, { radiusMeters: 10000 });

    const tightIdx = tightRanked.findIndex((p) => p.title === 'Far Famous Park');
    const wideIdx = wideRanked.findIndex((p) => p.title === 'Far Famous Park');
    // With a wide radius the far landmark survives noticeably better.
    expect(wideIdx).toBeLessThan(tightIdx === -1 ? 999 : tightIdx);
  });
});

describe('rankByInterestOffline (feature-code tier)', () => {
  function offlinePoi(p: Partial<Poi> & { pageId: number; title: string; lat: number; lon: number; featureCode?: string }): Poi {
    return poi({ ...p, source: 'geonames' });
  }

  const OFFLINE_POIS: Poi[] = [
    offlinePoi({ pageId: 100, title: 'Some Museum', lat: 37.45, lon: -122.14, featureCode: 'MUS' }),
    offlinePoi({ pageId: 101, title: 'Some Park', lat: 37.45, lon: -122.14, featureCode: 'PRK' }),
    offlinePoi({ pageId: 102, title: 'Some Church', lat: 37.45, lon: -122.14, featureCode: 'CH' }),
    offlinePoi({ pageId: 103, title: 'Some University', lat: 37.45, lon: -122.14, featureCode: 'UNIV' }),
    offlinePoi({ pageId: 104, title: 'Big City', lat: 37.45, lon: -122.14, featureCode: 'PPLA', articleLength: 800000 }),
    offlinePoi({ pageId: 105, title: 'Tiny Town', lat: 37.45, lon: -122.14, featureCode: 'PPL', articleLength: 5000 }),
    offlinePoi({ pageId: 106, title: 'Memorial Plaza', lat: 37.45, lon: -122.14 }), // no featureCode, name keyword
  ];

  it('Tier A (MUS / CH / PRK) ranks above Tier B (UNIV) and Tier D (PPL)', () => {
    const ranked = rankByInterestOffline(OFFLINE_POIS, gps, { radiusMeters: 5000 });
    const titles = ranked.map((p) => p.title);
    const museum = titles.indexOf('Some Museum');
    const university = titles.indexOf('Some University');
    const city = titles.indexOf('Big City');
    expect(museum).toBeLessThan(university);
    expect(museum).toBeLessThan(city);
    expect(university).toBeLessThan(city);
  });

  it('large city beats tiny town (population sort within Tier D)', () => {
    const ranked = rankByInterestOffline(OFFLINE_POIS, gps, { radiusMeters: 5000 });
    const big = ranked.findIndex((p) => p.title === 'Big City');
    const tiny = ranked.findIndex((p) => p.title === 'Tiny Town');
    expect(big).toBeLessThan(tiny);
  });

  it('name keyword boost surfaces "Memorial Plaza" despite empty featureCode', () => {
    const ranked = rankByInterestOffline(OFFLINE_POIS, gps, { radiusMeters: 5000 });
    const plaza = ranked.findIndex((p) => p.title === 'Memorial Plaza');
    const tiny = ranked.findIndex((p) => p.title === 'Tiny Town');
    expect(plaza).toBeLessThan(tiny);
  });

  it('hidden-gems mode flips tier order so Tier D (towns) ranks above Tier A (landmarks)', () => {
    const ranked = rankByInterestOffline(OFFLINE_POIS, gps, { hiddenGems: true, radiusMeters: 5000 });
    const tiny = ranked.findIndex((p) => p.title === 'Tiny Town');
    const museum = ranked.findIndex((p) => p.title === 'Some Museum');
    expect(tiny).toBeLessThan(museum);
  });
});

describe('rankByInterestSync (paint-fast fallback)', () => {
  it('still sorts by article length × distance decay (legacy behavior preserved)', () => {
    const ranked = rankByInterestSync(PALO_ALTO_POIS, gps, { radiusMeters: 5000 });
    // Stanford University has the longest article and is one of the closer
    // POIs, so it should be at or near the top.
    expect(ranked[0].title).toBe('Stanford University');
  });
});
