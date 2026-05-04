import { distanceMeters, type Poi } from './PoiService';
import type { GPSContext } from './InferenceService';
import type { WikipediaSignals } from './wikipediaSignals';

export const AROUND_YOU_CAP = 15;  // was 10
const DEFAULT_RADIUS_METERS = 5000;
// Confidence gate — if fewer than this many candidates returned pageviews,
// we assume the network call largely failed and fall back to the sync ranker
// rather than mix scoring scales. 1 hit is enough: even a single pageview
// signal is better than falling back to the length-biased sync ranker.
const MIN_CONFIDENCE_PAGEVIEW_HITS = 1;

interface RankOptions {
  hiddenGems?: boolean;
  cap?: number;
  /**
   * Search radius the user picked. Used to scale the distance-decay half-life
   * so a 10 km search doesn't over-decay landmarks 6 km out, and a 1 km search
   * doesn't reward farther things too generously.
   */
  radiusMeters?: number;
}

function withLiveDistances(pois: Poi[], gps: GPSContext | null): Poi[] {
  if (!gps) return pois;
  return pois.map((p) => ({
    ...p,
    distanceMeters: distanceMeters(gps.latitude, gps.longitude, p.latitude, p.longitude),
  }));
}

// Adaptive distance-decay half-life. Half-life = max(800 m, radius/2) so:
//   • dense urban search (radius=1km) → d0=800m → close-up bias.
//   • wide search (radius=10km) → d0=5000m → famous landmarks survive.
function distanceDecay(meters: number, radiusMeters: number): number {
  const d0 = Math.max(800, radiusMeters / 2);
  return Math.exp(-meters / d0);
}

// ---------------------------------------------------------------------------
// Sync rankers
// ---------------------------------------------------------------------------

// Length × distance-decay. Used as the paint-fast initial sort while the
// composite ranker waits on Wikipedia signals, and as the fallback when the
// network is unreachable. POIs missing articleLength are treated as the
// median so they don't sink to the bottom of every list.
export function rankByInterestSync(
  pois: Poi[],
  gps: GPSContext | null,
  options: RankOptions = {}
): Poi[] {
  const { hiddenGems = false, cap = AROUND_YOU_CAP, radiusMeters = DEFAULT_RADIUS_METERS } = options;
  const withDist = withLiveDistances(pois, gps);
  const lengths = withDist
    .map((p) => p.articleLength)
    .filter((l): l is number => typeof l === 'number');
  const sorted = [...lengths].sort((a, b) => a - b);
  const median = sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)];
  // 75th-percentile cap: prevents a single massive article (e.g. a 250 KB
  // tech-company HQ page) from dominating when all other articles are much
  // shorter. Closer landmarks with moderate article lengths can still win.
  const p75 = sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length * 0.75)];

  const scored = withDist.map((p) => {
    const rawLen = p.articleLength ?? median;
    const len = p75 > 0 ? Math.min(p75, rawLen) : rawLen;
    const decay = distanceDecay(p.distanceMeters, radiusMeters);
    const base = hiddenGems ? -len : len;
    // Multiplicative soft demotion for the same patterns the composite
    // ranker penalises — chains, broad admin areas, road infra, generic
    // schools — so the sync first paint doesn't surface obvious noise that
    // the composite ranker would have correctly buried.
    const blockWeight = hiddenGems ? 0 : descBlocklistPenalty(p.title, p.description ?? '');
    const blockMultiplier = blockWeight > 0 ? Math.max(0.05, 1 - blockWeight / 100) : 1;
    return { poi: p, score: base * decay * blockMultiplier };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, cap).map((s) => s.poi);
}

// ---------------------------------------------------------------------------
// Offline ranker
// ---------------------------------------------------------------------------

// Tier scoring over GeoNames feature codes. Higher = more touristy.
// Codes pulled from the curated set in build_geo_db.py.
const TIER_A = new Set([
  'MUS', 'CSTL', 'MNMT', 'MSQE', 'TMPL', 'CH', 'RUIN', 'OPRA', 'THTR',
  'ZOO', 'LIBR', 'STDM', 'AMUS', 'GDN', 'PRK', 'NATP', 'RES', 'RESN',
  'RESF', 'RESV', 'TOWR',
]);
const TIER_B = new Set(['UNIV', 'SCH', 'HSP', 'MKT', 'RLG', 'ARCH', 'PYR']);
// Tier C = any other S/L feature class (3-letter codes not in A or B).
// Tier D = P-class populated places (PPL, PPLC, PPLA, etc.).

function featureCodeTier(code: string | undefined, population: number | undefined): number {
  if (!code) return 0;
  if (TIER_A.has(code)) return 100;
  if (TIER_B.has(code)) return 60;
  if (code.startsWith('PPL')) {
    const p = typeof population === 'number' ? Math.max(1, population) : 1;
    return 10 + Math.log10(p);
  }
  // Tier C catch-all for any other GeoNames code (S/L classes, plus unknowns).
  return 30;
}

const NAME_KEYWORD_RE = /memorial|historic|garden|botanical|national|monument|museum|park|cathedral|temple|library|stadium|theatre|theater/i;

function nameKeywordBoost(name: string): number {
  return NAME_KEYWORD_RE.test(name) ? 15 : 0;
}

export function rankByInterestOffline(
  pois: Poi[],
  gps: GPSContext | null,
  options: RankOptions = {}
): Poi[] {
  const { hiddenGems = false, cap = AROUND_YOU_CAP, radiusMeters = DEFAULT_RADIUS_METERS } = options;
  const withDist = withLiveDistances(pois, gps);

  // For length-based fallback (Wikipedia POIs that survived as a stale cache
  // without a featureCode), normalise by the median so the score lands in
  // roughly the same scale as the feature-code tiers (0..100).
  const lengths = withDist
    .map((p) => p.articleLength)
    .filter((l): l is number => typeof l === 'number');
  lengths.sort((a, b) => a - b);
  const median = lengths.length === 0 ? 1 : Math.max(1, lengths[Math.floor(lengths.length / 2)]);

  const scored = withDist.map((p) => {
    let tier: number;
    if (p.featureCode) {
      tier = featureCodeTier(p.featureCode, p.articleLength);
    } else if (typeof p.articleLength === 'number') {
      // Stale Wikipedia cache in offline mode — no GeoNames featureCode is
      // available. Map article length onto roughly the Tier-A..Tier-D range
      // so the ranker still discriminates instead of collapsing to 0.
      const ratio = p.articleLength / median;
      tier = Math.min(100, 30 + 30 * Math.log10(1 + ratio));
    } else {
      tier = 30; // unknown — Tier-C catch-all.
    }
    if (hiddenGems) tier = 110 - tier;
    const boost = hiddenGems ? 0 : nameKeywordBoost(p.title);
    const decay = distanceDecay(p.distanceMeters, radiusMeters);
    return { poi: p, score: (tier + boost) * decay };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, cap).map((s) => s.poi);
}

// ---------------------------------------------------------------------------
// Online composite ranker
// ---------------------------------------------------------------------------

const TOURIST_ALLOWLIST_RE =
  /^category:.*(museums|parks|landmarks|monuments|memorials|historic |tourist attractions|gardens|churches|cathedrals|theatres|theaters|stadia|stadiums|libraries|art galleries|amphitheatres|amphitheaters|botanical|national parks|reservations|opera houses|concert halls|aquaria|aquariums|zoos|world heritage)/i;
const CORP_BLOCKLIST_RE =
  /^category:.*(companies based in|technology companies|electronics manufacturers|software companies|holding companies|conglomerates|multinational companies)/i;
const DESCRIPTION_KEYWORD_RE =
  /\b(museum|park|memorial|historic|church|library|garden|stadium|theatre|theater|cathedral|monument|landmark|gallery|temple|cemetery|fortress|castle|palace)\b/i;

// Soft-deny patterns ported from PoiService.isTouristic. These used to be a
// hard pre-rank filter that occasionally dropped real landmarks whose
// description happened to contain a flagged word. As a ranking penalty they
// demote the obvious noise (chains, generic admin areas, road infra, generic
// schools, corporate descriptors) so it almost never surfaces — but a famous
// place caught up in the regex still has a path to the visible list if its
// other signals are strong enough.
const DESC_BLOCKLIST_PATTERNS: Array<{ rx: RegExp; weight: number }> = [
  // Chains / franchises / retail.
  { rx: /\bchain of\b/i, weight: 80 },
  { rx: /\b(convenience|grocery|super|drug|hardware|coffee|fast.?food)\s*(store|market)?\s*(chain|company|corporation|franchise)?\b/i, weight: 80 },
  { rx: /\b(retail|franchise|multinational)\s+(chain|corporation|company|conglomerate)\b/i, weight: 80 },
  // Broad administrative entities.
  { rx: /\b(country|sovereign state|nation|u\.s\. state|federated state) in\b/i, weight: 60 },
  { rx: /\b(county|state|municipality|unincorporated community) in\b/i, weight: 50 },
  // Roads and transit infrastructure (transit hubs themselves are usually fine; this targets the generic descriptors).
  { rx: /\b(highway|freeway|interstate|expressway|road|state route) in\b/i, weight: 60 },
  // Generic business / brand descriptors.
  { rx: /\b(american|international|public|private) (company|corporation|conglomerate)\b/i, weight: 50 },
  { rx: /\b(multinational|holding|conglomerate|publicly[\s-]?traded|limited liability) (company|corporation)\b/i, weight: 60 },
  { rx: /\b(information technology|consumer electronics|oil and gas|financial services|investment banking|electronic commerce|software|hardware|semiconductor|biotechnology|pharmaceutical|aerospace|automotive|telecommunications|energy|insurance|media) (company|corporation|conglomerate|firm|manufacturer)\b/i, weight: 60 },
  // Generic schools (famous ones get past via descBoost / catBoost / pageviews).
  { rx: /\b(elementary|middle|secondary) school\b/i, weight: 40 },
];

function descBlocklistPenalty(title: string, description: string): number {
  const text = `${title} ${description}`.toLowerCase();
  let penalty = 0;
  for (const { rx, weight } of DESC_BLOCKLIST_PATTERNS) {
    if (rx.test(text)) penalty = Math.max(penalty, weight);
  }
  return penalty;
}

interface CompositeBreakdown {
  catBoost: number;
  descBoost: number;
  langBoost: number;
  pvScore: number;
  landmarkBoost: number;
  corpPenalty: number;
  noSignalPenalty: number;
  descBlocklist: number;
  decay: number;
  raw: number;
  final: number;
}

function compositeScore(
  poi: Poi,
  signals: WikipediaSignals | undefined,
  hiddenGems: boolean,
  maxPageviews: number,
  radiusMeters: number
): CompositeBreakdown {
  const cats = signals?.categories ?? [];
  const langCount = signals?.langlinkCount ?? 0;
  const pv = signals?.pageviews60d ?? 0;
  const desc = poi.description ?? '';

  const hasAllowlist = cats.some((c) => TOURIST_ALLOWLIST_RE.test(c));
  const hasCorpCat = cats.some((c) => CORP_BLOCKLIST_RE.test(c));
  const hasDescKeyword = DESCRIPTION_KEYWORD_RE.test(`${poi.title} ${desc}`);

  const catBoost = hasAllowlist ? 50 : 0;
  const descBoost = hasDescKeyword ? 20 : 0;
  const langBoost = Math.min(30, 0.5 * langCount);
  const pvNorm = maxPageviews > 0 ? Math.log10(1 + pv) / Math.log10(1 + maxPageviews) : 0;
  const pvScore = 50 * pvNorm;
  // MediaWiki coordinates.type='landmark' identifies genuine physical
  // landmarks (trees, statues, bridges, small monuments) that often have
  // short Wikipedia articles and low pageviews but are real tourist stops.
  const landmarkBoost = poi.coordType === 'landmark' ? 25 : 0;
  const corpPenalty = !hiddenGems && hasCorpCat ? 40 : 0;
  const noSignalPenalty = !hiddenGems && cats.length === 0 && pv === 0 ? 25 : 0;
  // Soft port of the old isTouristic blocklist: heavy negative weight so
  // chains / admin areas / corporate entries almost never surface, but a
  // famous place caught up in the regex can still climb if its other signals
  // are strong (catBoost 50 + pvScore 50 + landmarkBoost 25 can offset).
  const descBlocklist = !hiddenGems ? descBlocklistPenalty(poi.title, desc) : 0;

  let raw = catBoost + descBoost + langBoost + pvScore + landmarkBoost - corpPenalty - noSignalPenalty - descBlocklist;
  // Hidden-gems mode: divide by (1 + pv_norm) so the famous-est sink, but
  // the tourist-allowlist boost still ensures we surface real places.
  if (hiddenGems) raw = raw / (1 + pvNorm);

  const decay = distanceDecay(poi.distanceMeters, radiusMeters);
  const final = raw * decay;
  return { catBoost, descBoost, langBoost, pvScore, landmarkBoost, corpPenalty, noSignalPenalty, descBlocklist, decay, raw, final };
}

export function rankByInterestOnline(
  pois: Poi[],
  gps: GPSContext | null,
  signals: Map<number, WikipediaSignals>,
  options: RankOptions = {}
): Poi[] {
  const { hiddenGems = false, cap = AROUND_YOU_CAP, radiusMeters = DEFAULT_RADIUS_METERS } = options;
  const withDist = withLiveDistances(pois, gps);

  // Confidence gate — if too few candidates returned pageviews data, fall
  // back to the sync ranker rather than mix two scoring scales.
  const pvHits = withDist.filter((p) => (signals.get(p.pageId)?.pageviews60d ?? 0) > 0).length;
  if (pvHits < MIN_CONFIDENCE_PAGEVIEW_HITS) {
    return rankByInterestSync(pois, gps, options);
  }

  const maxPv = withDist.reduce(
    (m, p) => Math.max(m, signals.get(p.pageId)?.pageviews60d ?? 0),
    0
  );

  const scored = withDist.map((p) => {
    const breakdown = compositeScore(p, signals.get(p.pageId), hiddenGems, maxPv, radiusMeters);
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log(
        '[poiRank]',
        p.title,
        JSON.stringify({
          len: p.articleLength,
          pv: signals.get(p.pageId)?.pageviews60d ?? 0,
          dist: Math.round(p.distanceMeters),
          ...breakdown,
        })
      );
    }
    return { poi: p, score: breakdown.final };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, cap).map((s) => s.poi);
}

// ---------------------------------------------------------------------------
// Backwards-compatible alias
// ---------------------------------------------------------------------------

// Existing callers (ChatScreen pre-refactor) still call rankByInterest;
// dispatch to the sync ranker so nothing breaks while the new wiring lands.
export const rankByInterest = rankByInterestSync;
