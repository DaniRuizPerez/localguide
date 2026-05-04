import { rankByInterest, AROUND_YOU_CAP } from '../services/poiRanking';
import type { Poi } from '../services/PoiService';
import type { GPSContext } from '../services/InferenceService';

const gps: GPSContext = {
  latitude: 37.4419,
  longitude: -122.1430,
  accuracy: 10,
  placeName: 'Palo Alto',
};

function poi(partial: Partial<Poi> & { title: string; latitude: number; longitude: number }): Poi {
  return {
    pageId: Math.floor(Math.random() * 1e6),
    distanceMeters: 0,
    source: 'wikipedia',
    ...partial,
  };
}

describe('rankByInterest', () => {
  it('sorts by Wikipedia article length descending (interest proxy)', () => {
    const input = [
      poi({ title: 'Short', latitude: 37.45, longitude: -122.14, articleLength: 1000 }),
      poi({ title: 'Long', latitude: 37.46, longitude: -122.14, articleLength: 50000 }),
      poi({ title: 'Medium', latitude: 37.47, longitude: -122.14, articleLength: 10000 }),
    ];
    const ranked = rankByInterest(input, gps);
    expect(ranked.map((p) => p.title)).toEqual(['Long', 'Medium', 'Short']);
  });

  it('caps result at AROUND_YOU_CAP', () => {
    const input = Array.from({ length: 25 }, (_, i) =>
      poi({
        title: `POI ${i}`,
        latitude: 37.45 + i * 0.001,
        longitude: -122.14,
        articleLength: 1000 * (25 - i),
      })
    );
    const ranked = rankByInterest(input, gps);
    expect(ranked).toHaveLength(AROUND_YOU_CAP);
    // Highest articleLength should be POI 0 (25 * 1000 = 25000).
    expect(ranked[0].title).toBe('POI 0');
  });

  it('hidden-gems mode flips the order (shortest articles first)', () => {
    const input = [
      poi({ title: 'Famous', latitude: 37.45, longitude: -122.14, articleLength: 50000 }),
      poi({ title: 'Hidden', latitude: 37.46, longitude: -122.14, articleLength: 1500 }),
    ];
    const ranked = rankByInterest(input, gps, { hiddenGems: true });
    expect(ranked.map((p) => p.title)).toEqual(['Hidden', 'Famous']);
  });

  it('treats POIs missing articleLength as median so they do not sink to the bottom', () => {
    const input = [
      poi({ title: 'A', latitude: 37.45, longitude: -122.14, articleLength: 100 }),
      poi({ title: 'B', latitude: 37.45, longitude: -122.14, articleLength: 1000 }),
      poi({ title: 'NoLen', latitude: 37.45, longitude: -122.14 }), // missing
      poi({ title: 'C', latitude: 37.45, longitude: -122.14, articleLength: 10000 }),
    ];
    const ranked = rankByInterest(input, gps);
    // Median of [100,1000,10000] = 1000. NoLen should rank tied with B.
    expect(ranked.map((p) => p.title)).toEqual(['C', 'B', 'NoLen', 'A']);
  });

  it('recomputes distance from the live gps fix (overrides stale cached values)', () => {
    const input = [
      // A POI at exactly the user's GPS — distance should be 0 regardless of
      // what the cached field said.
      poi({
        title: 'Here',
        latitude: gps.latitude,
        longitude: gps.longitude,
        articleLength: 5000,
        distanceMeters: 999_999,
      }),
      // A POI roughly 1.1 km away — Stanford Memorial Church coords.
      poi({
        title: 'Stanford Memorial Church',
        latitude: 37.4274,
        longitude: -122.1697,
        articleLength: 8000,
        distanceMeters: 0, // stale "0 m" — should be overwritten
      }),
    ];
    const ranked = rankByInterest(input, gps);
    const here = ranked.find((p) => p.title === 'Here')!;
    const church = ranked.find((p) => p.title === 'Stanford Memorial Church')!;
    expect(here.distanceMeters).toBe(0);
    expect(church.distanceMeters).toBeGreaterThan(2000);
    expect(church.distanceMeters).toBeLessThan(3000);
  });

  it('passes through unchanged when gps is null (still sorts by interest, no distance overwrite)', () => {
    const input = [
      poi({ title: 'A', latitude: 0, longitude: 0, articleLength: 100, distanceMeters: 500 }),
      poi({ title: 'B', latitude: 0, longitude: 0, articleLength: 5000, distanceMeters: 200 }),
    ];
    const ranked = rankByInterest(input, null);
    expect(ranked.map((p) => p.title)).toEqual(['B', 'A']);
    expect(ranked.find((p) => p.title === 'A')!.distanceMeters).toBe(500);
  });

  it('respects an explicit cap override (used to feed plan-my-day a tighter top-N)', () => {
    const input = Array.from({ length: 20 }, (_, i) =>
      poi({
        title: `POI ${i}`,
        latitude: 37.45,
        longitude: -122.14,
        articleLength: 1000 * (20 - i),
      })
    );
    const ranked = rankByInterest(input, gps, { cap: 5 });
    expect(ranked).toHaveLength(5);
    expect(ranked[0].title).toBe('POI 0');
  });
});
