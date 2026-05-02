// Notable-places lookup backed by Wikipedia's GeoSearch endpoint when online,
// the bundled GeoNames cities15000 + per-country packs when offline. We pick
// Wikipedia over Overpass/Google Places because "has a Wikipedia article" is a
// reliable proxy for "interesting enough to narrate about" — Stanford, Steve
// Jobs house, well-known parks, historic churches all surface, while generic
// convenience stores don't. Free, no API key, no rate-limit at our usage. The
// GeoNames offline path has narrower coverage but ships real coordinates so
// the offline-mode chip list shows actual nearby places instead of LLM
// hallucinations.
import GeoModule, { isGeoModuleAvailable, type GeoPlace } from '../native/GeoModule';

export interface Poi {
  pageId: number;
  title: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  /**
   * Where this suggestion came from. 'wikipedia' and 'geonames' entries
   * carry real coords (safe to geofence); 'llm' entries are model-generated
   * names with the user's own position used as a placeholder — proximity
   * checks must skip them so we don't auto-narrate the user's current
   * location.
   */
  source: 'wikipedia' | 'geonames' | 'llm';
  /**
   * GeoNames feature code for 'geonames' entries (e.g. PRK = park, CH =
   * church, MUS = museum). Lets the chip-row emoji classifier do a much
   * tighter job than parsing the title alone. Absent for other sources.
   */
  featureCode?: string;
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

/**
 * Streaming variant of fetchNearby: emits whatever is available locally first
 * (in-memory cache, then bundled GeoNames data — typically tens of ms), then
 * emits the canonical Wikipedia list once the network returns. Lets the UI
 * paint real, named POIs while the slower request is still in flight instead
 * of blanking out the "Around you" section for the full Wikipedia round trip.
 *
 * `onPartial` may be invoked 0–2 times before the returned promise resolves.
 * The promise resolves with the same final list a normal `fetchNearby` would
 * have returned, so existing callers can keep using whichever shape suits.
 */
export interface StreamHandlers {
  onPartial?: (pois: Poi[], stage: 'cache' | 'geonames') => void;
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

async function fetchNearbyFromGeoNames(
  lat: number,
  lon: number,
  radiusMeters: number,
  limit: number
): Promise<Poi[]> {
  if (!isGeoModuleAvailable()) return [];
  try {
    // Ask for 2x the cap so the downstream rank/filter has room to work
    // (hidden-gems re-rank, dedup, etc). The native side caps at 200.
    const places = await GeoModule.nearbyPlaces(lat, lon, radiusMeters, Math.min(200, limit * 2));
    return places.map(geoPlaceToPoi);
  } catch {
    return [];
  }
}

function geoPlaceToPoi(p: GeoPlace): Poi {
  return {
    // GeoNames IDs are positive 32-bit integers; Poi.pageId originated as a
    // Wikipedia pageid but the field's only consumer is React `key`, so we
    // can reuse it cleanly here.
    pageId: p.geonameid,
    title: p.name,
    latitude: p.lat,
    longitude: p.lon,
    distanceMeters: p.distanceMeters,
    source: 'geonames',
    featureCode: p.featureCode ?? undefined,
    // Borrow the population proxy: places with a non-zero population get
    // ranked first under hidden-gems sort (fewer people = lesser-known).
    articleLength: p.population > 0 ? p.population : undefined,
    // Tiny human-readable hint. Region/admin1Name when available, else the
    // feature code. Keeps the row visually consistent with the Wikipedia
    // path which shows a one-line description.
    description: p.admin1Name ?? undefined,
  };
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
    // Corporate HQs leaking through GeoSearch with the "<adjective>+
    // <industry> company/corporation" pattern. These describe the
    // organisation itself (HP, Tesla, Alphabet) rather than a place a
    // visitor would walk to. Two-word industry slug captures
    // "information technology", "consumer electronics", "oil and gas",
    // "financial services", etc., and a single-word slug catches
    // "technology company" / "pharmaceutical corporation".
    /\b(multinational|holding|conglomerate|publicly[\s-]?traded|limited liability) (company|corporation)\b/,
    /\b(information technology|consumer electronics|oil and gas|financial services|investment banking|electronic commerce|software|hardware|semiconductor|biotechnology|pharmaceutical|aerospace|automotive|telecommunications|energy|insurance|media) (company|corporation|conglomerate|firm|manufacturer)\b/,
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

    // Offline mode: no network call. Try the bundled GeoNames data first —
    // cities15000 plus any installed country packs, which include parks and
    // curated landmark codes. If GeoNames returns nothing (no pack installed
    // for this region, or the user is somewhere genuinely uncovered), fall
    // back to the stale Wikipedia cache, then to []. The empty case lets
    // callers fall through to the LLM as today.
    if (options.offline === true) {
      const geoPois = await fetchNearbyFromGeoNames(latitude, longitude, radiusMeters, limit);
      if (geoPois.length > 0) {
        return rankPois(geoPois, options.hiddenGems === true).slice(0, limit);
      }
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
      // Wikipedia rejects unidentified UAs with HTTP 403 (User-Agent policy).
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'LocalGuide/1.0 (https://github.com/DaniRuizPerez/localguide)' },
      });
      if (!response.ok) {
        return rankPois(cached?.pois ?? [], options.hiddenGems === true).slice(0, limit);
      }
      const data = (await response.json()) as {
        query?: { pages?: Record<string, WikiPage> };
      };
      let pages = data.query?.pages ? Object.values(data.query.pages) : [];

      // MediaWiki quirk: when `prop=coordinates` is paired with
      // `generator=geosearch`, only ~1/3 of pages actually return their
      // coordinates — the rest come back without the prop even though the
      // page itself has primary coords. Without coords we'd have to fall
      // back to the user's GPS as a placeholder, which makes every distance
      // read "0 m". Patch the gap with a follow-up `prop=coordinates` call
      // keyed on pageids; one extra round-trip is cheaper than showing the
      // wrong distance to every famous nearby landmark.
      const missingCoords = pages.filter((p) => !p.coordinates?.[0]);
      if (missingCoords.length > 0) {
        const ids = missingCoords.map((p) => p.pageid).join('|');
        const coordsUrl =
          `https://en.wikipedia.org/w/api.php?action=query` +
          `&pageids=${encodeURIComponent(ids)}` +
          `&prop=coordinates&format=json&origin=*`;
        try {
          const coordsRes = await fetch(coordsUrl, {
            signal: controller.signal,
            headers: { 'User-Agent': 'LocalGuide/1.0 (https://github.com/DaniRuizPerez/localguide)' },
          });
          if (coordsRes.ok) {
            const coordsData = (await coordsRes.json()) as {
              query?: { pages?: Record<string, WikiPage> };
            };
            const coordsByPageId = new Map<number, Array<{ lat: number; lon: number }>>();
            for (const p of Object.values(coordsData.query?.pages ?? {})) {
              if (p.coordinates) coordsByPageId.set(p.pageid, p.coordinates);
            }
            pages = pages.map((p) =>
              p.coordinates?.[0] ? p : { ...p, coordinates: coordsByPageId.get(p.pageid) }
            );
          }
        } catch {
          // Best-effort enrichment; if it fails, drop the coordless pages
          // below rather than fall through to the GPS placeholder.
        }
      }

      const pois: Poi[] = pages
        .filter((p) => isTouristic(p.title, p.description))
        // Drop pages we still couldn't get coords for — better to show a
        // shorter list than to lie about the distance.
        .filter((p) => Boolean(p.coordinates?.[0]))
        .map((p) => {
          const coord = p.coordinates![0];
          return {
            pageId: p.pageid,
            title: p.title,
            latitude: coord.lat,
            longitude: coord.lon,
            distanceMeters: distanceMeters(latitude, longitude, coord.lat, coord.lon),
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

  /**
   * Same contract as `fetchNearby`, but emits whatever is locally available
   * first via `handlers.onPartial`. Order of emissions:
   *   1. In-memory cache (if present, even when stale — the freshness check
   *      below decides whether to skip the network).
   *   2. Bundled GeoNames lookup (cities15000 + installed country packs) —
   *      always runs in parallel with Wikipedia in online mode, since the
   *      native side is on-device and finishes in milliseconds while the
   *      Wikipedia geosearch routinely takes 1–2 s on a healthy network and
   *      up to 8 s on a flaky one.
   * The promise resolves with the canonical list (Wikipedia when available,
   * otherwise GeoNames, otherwise stale cache or []), exactly matching the
   * return shape of `fetchNearby`.
   */
  async fetchNearbyStreaming(
    latitude: number,
    longitude: number,
    radiusMeters: number = DEFAULT_RADIUS_METERS,
    limit: number = DEFAULT_LIMIT,
    options: FetchOptions = {},
    handlers: StreamHandlers = {}
  ): Promise<Poi[]> {
    const key = cacheKey(latitude, longitude, radiusMeters);
    const now = Date.now();
    const cached = cache.get(key);

    // Fresh cache hit: return it synchronously (well, microtask) — no need to
    // refetch or stream partials, the consumer is going to render it anyway.
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      return rankPois(cached.pois, options.hiddenGems === true).slice(0, limit);
    }

    // Offline mode keeps its existing single-path behavior — there's no
    // network to race against, and surfacing intermediate cache hits would
    // double-render for no win.
    if (options.offline === true) {
      return this.fetchNearby(latitude, longitude, radiusMeters, limit, options);
    }

    // Stale cache: paint it immediately so the user sees real names instead
    // of a spinner while the fresh request is in flight. The UI will swap to
    // the new list when it lands; this just kills the empty-flicker.
    if (cached && cached.pois.length > 0) {
      handlers.onPartial?.(
        rankPois(cached.pois, options.hiddenGems === true).slice(0, limit),
        'cache'
      );
    }

    // Kick off both lookups in parallel. GeoNames is on-device SQLite —
    // typically finishes in < 50 ms, well before Wikipedia. Wikipedia stays
    // the source of truth (richer descriptions, popularity-ranked); GeoNames
    // is the "show something now" stand-in.
    let wikipediaSettled = false;
    const geoNamesP = fetchNearbyFromGeoNames(latitude, longitude, radiusMeters, limit)
      .then((geoPois) => {
        // Don't bother emitting if Wikipedia already came back first.
        if (wikipediaSettled) return;
        if (geoPois.length === 0) return;
        handlers.onPartial?.(
          rankPois(geoPois, options.hiddenGems === true).slice(0, limit),
          'geonames'
        );
      })
      .catch(() => {
        // Native errors are non-fatal — this is a "best effort" partial.
      });

    const wikiP = this.fetchNearby(latitude, longitude, radiusMeters, limit, options).then(
      (pois) => {
        wikipediaSettled = true;
        return pois;
      }
    );

    // We await Wikipedia but don't block the caller on geoNamesP — the
    // GeoNames partial only matters if it lands before Wikipedia, and
    // resolving the returned promise is what tells the UI "you have the real
    // list now". Floating the GeoNames promise is fine; its only side effect
    // is firing onPartial.
    void geoNamesP;
    return wikiP;
  },

  clearCache(): void {
    cache.clear();
  },
};
