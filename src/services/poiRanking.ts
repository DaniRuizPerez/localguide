import { distanceMeters, type Poi } from './PoiService';
import type { GPSContext } from './InferenceService';

export const AROUND_YOU_CAP = 10;

interface RankOptions {
  hiddenGems?: boolean;
  cap?: number;
}

// Rank POIs by Wikipedia article length (interest proxy) and cap the result.
// Recomputes distance from the live gps fix so a small drift between
// useNearbyPois cell-key refires shows up immediately. Hidden-gems mode flips
// the rank so shorter articles surface first. POIs missing articleLength are
// treated as the median so they don't sink to the bottom of every list.
export function rankByInterest(
  pois: Poi[],
  gps: GPSContext | null,
  options: RankOptions = {}
): Poi[] {
  const { hiddenGems = false, cap = AROUND_YOU_CAP } = options;
  const withLiveDistance = gps
    ? pois.map((p) => ({
        ...p,
        distanceMeters: distanceMeters(gps.latitude, gps.longitude, p.latitude, p.longitude),
      }))
    : pois;
  const lengths = withLiveDistance
    .map((p) => p.articleLength)
    .filter((l): l is number => typeof l === 'number');
  lengths.sort((a, b) => a - b);
  const median = lengths.length === 0 ? 0 : lengths[Math.floor(lengths.length / 2)];
  const ranked = [...withLiveDistance].sort((a, b) => {
    const aLen = a.articleLength ?? median;
    const bLen = b.articleLength ?? median;
    return hiddenGems ? aLen - bLen : bLen - aLen;
  });
  return ranked.slice(0, cap);
}
