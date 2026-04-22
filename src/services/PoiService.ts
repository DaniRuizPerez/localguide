// Notable-places lookup backed by Wikipedia's GeoSearch endpoint. We pick
// Wikipedia over Overpass/Google Places because "has a Wikipedia article" is a
// reliable proxy for "interesting enough to narrate about" — Stanford, Steve
// Jobs house, well-known parks, historic churches all surface, while generic
// convenience stores don't. Free, no API key, no rate-limit at our usage.

export interface Poi {
  pageId: number;
  title: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  /**
   * Where this suggestion came from. 'wikipedia' entries have real coords
   * (safe to geofence); 'llm' entries are model-generated names with the
   * user's own position used as a placeholder — proximity checks must skip
   * them so we don't auto-narrate the user's current location.
   */
  source: 'wikipedia' | 'llm';
  /**
   * Wikipedia article length in bytes. Used as a popularity proxy: longer
   * article ≈ more famous place. Absent when we couldn't fetch it (offline
   * or the API dropped the prop).
   */
  articleLength?: number;
  /**
   * Wikipedia's one-line short description (e.g. "public park in Manhattan").
   * Populated for 'wikipedia' entries, absent for 'llm' entries.
   */
  description?: string;
}

export interface FetchOptions {
  /**
   * When true, re-rank so less-famous places (shorter Wikipedia articles)
   * sort to the top. See A7 Hidden Gems feature.
   */
  hiddenGems?: boolean;
  /**
   * When true, skip the network entirely. Returns cached results if still
   * warm; otherwise returns []. Callers are expected to fall back to the
   * on-device LLM when the array is empty in offline mode.
   */
  offline?: boolean;
}

// Cache key granularity: rounding to 3 decimal places (~110 m) means we reuse
// results while the user drifts around a neighborhood, but refetch when they
// walk more than a block. TTL handles the same drift in time.
const CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_RADIUS_METERS = 1000;
const DEFAULT_LIMIT = 20;
// Wikipedia usually replies in under a second. Cap at 8 s so a stalled socket
// (mobile radio half-attached, captive-portal Wi-Fi) can't leave the caller
// waiting forever — they'll see the cached-or-empty fallback instead.
const FETCH_TIMEOUT_MS = 8000;

interface CacheEntry {
  fetchedAt: number;
  pois: Poi[];
}

function cacheKey(lat: number, lon: number, radius: number): string {
  return `${lat.toFixed(3)}_${lon.toFixed(3)}_${radius}`;
}

// Haversine distance. Exported so proximity checks (UI + auto-narration) can
// compare the user's current GPS against Poi.latitude/longitude without
// round-tripping through Wikipedia (Wikipedia's `dist` is frozen at fetch time).
export function distanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

interface WikiPage {
  pageid: number;
  title: string;
  description?: string;
  coordinates?: Array<{ lat: number; lon: number }>;
  length?: number;
}

// Reject pages whose title or Wikipedia short-description smells like a
// non-tourism result. The big categories that leak through GeoSearch: admin
// areas (countries/states/counties/ZIPs), chain stores / franchises, road
// infrastructure, generic schools, corporate entities. Tourism-relevant pages
// (parks, museums, landmarks, historic sites) don't match any of these.
function isTouristic(title: string, description: string | null | undefined): boolean {
  const text = `${title} ${description ?? ''}`.toLowerCase();

  // Title-only blockers (exact or prefix matches; safer than running against
  // the combined text since a Wikipedia article's short description might
  // legitimately contain words like "chain" when describing a mountain range).
  if (/^(list of|lists of)\b/i.test(title)) return false;
  if (/^(zip code|postal code)\b/i.test(title)) return false;
  if (/^(interstate \d+|u\.s\. route|state route|california state route)\b/i.test(title)) return false;

  // Combined title+description blockers. These are pulled from what GeoSearch
  // was leaking into the chip list (7-Eleven, United States, etc.) plus the
  // common Wikipedia descriptor patterns they match.
  const blockers: RegExp[] = [
    // Chains / franchises / retail. Descriptions almost always include some
    // form of "chain of …", "retail chain", "convenience store chain", etc.
    /\bchain of\b/,
    /\b(convenience|grocery|super|drug|hardware|coffee|fast.?food)\s*(store|market)?\s*(chain|company|corporation|franchise)?\b/,
    /\b(retail|franchise|multinational)\s+(chain|corporation|company|conglomerate)\b/,
    // Broad administrative entities — "USA", "California", "San Mateo County".
    /\b(country|sovereign state|nation|u\.s\. state|federated state) in\b/,
    /\b(county|state|municipality|unincorporated community) in\b/,
    // Roads and infrastructure.
    /\b(highway|freeway|interstate|expressway|road|state route) in\b/,
    /\b(railway station|metro station|bus station|transit hub)\b/,
    // Generic business/brand descriptors that aren't tourist-worthy.
    /\b(american|international|public|private) (company|corporation|conglomerate)\b/,
    // Schools that aren't famous (famous ones have their own descriptor like
    // "private research university" which won't match).
    /\b(elementary|middle|secondary) school\b/,
  ];

  return !blockers.some((rx) => rx.test(text));
}

// Ranking function. Default (hiddenGems=false): nearest first. Hidden-gems:
// shorter article first (proxy for "less famous"), tiebreak by distance.
// POIs missing articleLength are treated as average fame so they don't sink
// below curated obscure picks.
function rankPois(pois: Poi[], hiddenGems: boolean): Poi[] {
  if (!hiddenGems) {
    return [...pois].sort((a, b) => a.distanceMeters - b.distanceMeters);
  }
  const lengths = pois.map((p) => p.articleLength).filter((l): l is number => typeof l === 'number');
  const median = lengths.length > 0
    ? lengths.slice().sort((a, b) => a - b)[Math.floor(lengths.length / 2)]
    : 0;
  return [...pois].sort((a, b) => {
    const aLen = a.articleLength ?? median;
    const bLen = b.articleLength ?? median;
    if (aLen !== bLen) return aLen - bLen;
    return a.distanceMeters - b.distanceMeters;
  });
}

const cache = new Map<string, CacheEntry>();

export const poiService = {
  async fetchNearby(
    latitude: number,
    longitude: number,
    radiusMeters: number = DEFAULT_RADIUS_METERS,
    limit: number = DEFAULT_LIMIT,
    options: FetchOptions = {}
  ): Promise<Poi[]> {
    const key = cacheKey(latitude, longitude, radiusMeters);
    const now = Date.now();
    const cached = cache.get(key);
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      return rankPois(cached.pois, options.hiddenGems === true).slice(0, limit);
    }

    // Offline mode: no network call. Return stale cache if we have one (even
    // past TTL — something is better than nothing when the user is explicitly
    // offline), else empty so callers fall through to the LLM.
    if (options.offline === true) {
      return rankPois(cached?.pois ?? [], options.hiddenGems === true).slice(0, limit);
    }

    // Use the generator form of the API so we can pull `description` (the
    // one-line Wikipedia short description) alongside the geosearch hits.
    // The description is what lets us filter out chains / admin areas / roads
    // without maintaining a brittle per-title blocklist. Also pull article
    // `length` (via prop=info) as a popularity proxy for hidden-gems ranking.
    // Request more than `limit` from Wikipedia since the description filter
    // trims the list; we want to land at least `limit` real attractions when
    // possible.
    const rawLimit = Math.max(limit, 30);
    const url =
      `https://en.wikipedia.org/w/api.php?action=query` +
      `&generator=geosearch` +
      `&ggscoord=${latitude}|${longitude}` +
      `&ggsradius=${Math.max(10, Math.min(10000, Math.round(radiusMeters)))}` +
      `&ggslimit=${Math.max(1, Math.min(500, rawLimit))}` +
      `&prop=description|coordinates|info` +
      `&inprop=length` +
      `&format=json&origin=*`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        return rankPois(cached?.pois ?? [], options.hiddenGems === true).slice(0, limit);
      }
      const data = (await response.json()) as {
        query?: { pages?: Record<string, WikiPage> };
      };
      const pages = data.query?.pages ? Object.values(data.query.pages) : [];
      const pois: Poi[] = pages
        .filter((p) => isTouristic(p.title, p.description))
        .map((p) => {
          const coord = p.coordinates?.[0];
          const lat = coord?.lat ?? latitude;
          const lon = coord?.lon ?? longitude;
          return {
            pageId: p.pageid,
            title: p.title,
            latitude: lat,
            longitude: lon,
            distanceMeters: distanceMeters(latitude, longitude, lat, lon),
            source: 'wikipedia' as const,
            articleLength: typeof p.length === 'number' ? p.length : undefined,
            description: p.description,
          };
        });
      // Cache the pre-ranked pool so we can re-rank cheaply if the toggle
      // changes without a network round-trip.
      cache.set(key, { fetchedAt: now, pois });
      return rankPois(pois, options.hiddenGems === true).slice(0, limit);
    } catch {
      // Offline, timeout, or network error — fall back to stale cache if we
      // have it so the UI doesn't flicker between populated and empty on
      // flaky networks.
      return rankPois(cached?.pois ?? [], options.hiddenGems === true).slice(0, limit);
    } finally {
      clearTimeout(timeoutId);
    }
  },

  clearCache(): void {
    cache.clear();
  },
};
