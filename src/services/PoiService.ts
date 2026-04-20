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
}

// Cache key granularity: rounding to 3 decimal places (~110 m) means we reuse
// results while the user drifts around a neighborhood, but refetch when they
// walk more than a block. TTL handles the same drift in time.
const CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_RADIUS_METERS = 1000;
const DEFAULT_LIMIT = 20;

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

class PoiService {
  private cache = new Map<string, CacheEntry>();

  async fetchNearby(
    latitude: number,
    longitude: number,
    radiusMeters: number = DEFAULT_RADIUS_METERS,
    limit: number = DEFAULT_LIMIT
  ): Promise<Poi[]> {
    const key = cacheKey(latitude, longitude, radiusMeters);
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.pois;
    }

    // Use the generator form of the API so we can pull `description` (the
    // one-line Wikipedia short description) alongside the geosearch hits.
    // The description is what lets us filter out chains / admin areas / roads
    // without maintaining a brittle per-title blocklist.
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
      `&prop=description|coordinates` +
      `&format=json&origin=*`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        return cached?.pois ?? [];
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
          };
        })
        .sort((a, b) => a.distanceMeters - b.distanceMeters)
        .slice(0, limit);
      this.cache.set(key, { fetchedAt: now, pois });
      return pois;
    } catch {
      // Offline or network error — fall back to stale cache if we have it so
      // the UI doesn't flicker between populated and empty on flaky networks.
      return cached?.pois ?? [];
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export const poiService = new PoiService();
