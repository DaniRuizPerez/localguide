/**
 * Thin service over `NativeModules.GeoModule` — formats the native bridge's
 * `GeoPlace` into a single human-readable label ("City, Region, Country") and
 * memoizes recent lookups so the proximity tick doesn't hammer the JNI bridge
 * as the user walks the same block.
 *
 * The legacy expo-location path in `useLocation.ts` still does grid-cell
 * caching at 3 decimals (~110 m). This memo is a smaller secondary cache
 * keyed at full coordinate precision so a programmatic burst of identical
 * lookups (e.g. proximity + chip-list firing the same tick) only costs one
 * native call.
 *
 * Country-pack discovery is also routed through here: the Kotlin
 * `availableCountryPacks()` currently returns `[]` (TODO until the CI
 * workflow publishes a Releases API), so for now we hit GitHub directly and
 * cache the response for an hour in-memory. Caching is per-process — the
 * settings sub-modal won't re-fetch on every open.
 */

import GeoModule, {
  isGeoModuleAvailable,
  type GeoCountryPackAvailable,
  type GeoPlace,
} from '../native/GeoModule';

// ─── Reverse-geocode label cache ──────────────────────────────────────────

const LABEL_CACHE_LIMIT = 16;
const labelCache = new Map<string, string | null>();

function cacheKey(lat: number, lon: number): string {
  // Full precision; the coarser grid cache lives in useLocation.ts.
  return `${lat}_${lon}`;
}

function rememberLabel(key: string, label: string | null): string | null {
  // LRU-ish behaviour: oldest entry evicted when we cross the cap. Map
  // preserves insertion order, so deleting + reinserting on hit keeps fresh
  // entries at the tail.
  if (labelCache.has(key)) labelCache.delete(key);
  labelCache.set(key, label);
  while (labelCache.size > LABEL_CACHE_LIMIT) {
    const oldest = labelCache.keys().next().value;
    if (oldest === undefined) break;
    labelCache.delete(oldest);
  }
  return label;
}

function formatPlace(place: GeoPlace): string | null {
  // City lives in `name`; region in `admin1Name` (falling back to the raw
  // `country_code` when admin1 isn't populated, e.g. small country packs);
  // country in `countryName`. Drop empty parts so we never emit "Paris, ,
  // France" or trailing commas.
  const parts: string[] = [];
  if (place.name) parts.push(place.name);
  const region = place.admin1Name && place.admin1Name.length > 0
    ? place.admin1Name
    : place.countryCode;
  if (region && region !== place.name) parts.push(region);
  if (place.countryName && place.countryName !== region) parts.push(place.countryName);
  if (parts.length === 0) return null;
  return parts.join(', ');
}

/**
 * Reverse-geocode a coordinate using the on-device cities15000 + per-country
 * packs. Returns a "City, Region, Country" label or null when the native
 * module is unavailable or no row falls within tolerance.
 */
export async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  if (!isGeoModuleAvailable()) return null;
  const key = cacheKey(lat, lon);
  if (labelCache.has(key)) return labelCache.get(key) ?? null;
  try {
    const place = await GeoModule.reverseGeocode(lat, lon);
    if (!place) return rememberLabel(key, null);
    return rememberLabel(key, formatPlace(place));
  } catch {
    // Treat native errors as "no result" — useLocation falls back to
    // expo-location's reverseGeocodeAsync in that case.
    return rememberLabel(key, null);
  }
}

/** Clear the in-memory memo. Test-only. */
export function __resetForTest(): void {
  labelCache.clear();
  cachedReleases = null;
  cachedReleasesAt = 0;
}

// ─── Country-pack discovery ───────────────────────────────────────────────

// ISO-3166 alpha-2 → display name. Covers the 30 countries we ship in
// tools/geonames/COUNTRIES.txt; anything outside this list is rendered with
// just the ISO code, which is fine because the picker won't list packs we
// haven't actually published.
const ISO_TO_NAME: Readonly<Record<string, string>> = Object.freeze({
  AR: 'Argentina',
  AT: 'Austria',
  AU: 'Australia',
  BE: 'Belgium',
  BR: 'Brazil',
  CA: 'Canada',
  CH: 'Switzerland',
  CN: 'China',
  CZ: 'Czechia',
  DE: 'Germany',
  DK: 'Denmark',
  ES: 'Spain',
  FI: 'Finland',
  FR: 'France',
  GB: 'United Kingdom',
  GR: 'Greece',
  IE: 'Ireland',
  IN: 'India',
  IT: 'Italy',
  JP: 'Japan',
  KR: 'South Korea',
  MX: 'Mexico',
  NL: 'Netherlands',
  NO: 'Norway',
  NZ: 'New Zealand',
  PL: 'Poland',
  PT: 'Portugal',
  SE: 'Sweden',
  US: 'United States',
  ZA: 'South Africa',
});

export function countryNameForIso(iso: string): string {
  return ISO_TO_NAME[iso.toUpperCase()] ?? iso.toUpperCase();
}

const RELEASES_URL =
  'https://api.github.com/repos/DaniRuizPerez/localguide/releases';
const RELEASES_TTL_MS = 60 * 60 * 1000; // 1 hour

interface GitHubAsset {
  name: string;
  size: number;
  browser_download_url: string;
}
interface GitHubRelease {
  tag_name: string;
  assets: GitHubAsset[];
}

export interface CountryPackListing extends GeoCountryPackAvailable {
  /** Direct download URL for the .db.gz asset; passed to installCountryPack(). */
  downloadUrl: string;
}

let cachedReleases: CountryPackListing[] | null = null;
let cachedReleasesAt = 0;

function parseSnapshotFromTag(tag: string): string {
  // Tags look like `geo-20260426`. Strip the prefix; if the tag doesn't
  // match, hand back the raw tag so the UI still has something to display.
  const m = /^geo-(\d{8})$/.exec(tag);
  if (!m) return tag;
  const [_, ymd] = m;
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function isCountryAsset(name: string): { iso: string } | null {
  // We expect e.g. `US.db.gz`, `GB.db.gz`. Skip the global `cities15000.db.gz`
  // — that one ships in the APK assets, not as a per-country pack.
  const m = /^([A-Z]{2})\.db\.gz$/.exec(name);
  if (!m) return null;
  return { iso: m[1] };
}

/**
 * Fetch the list of country packs available for download. Returns [] when
 * the network is unreachable so the picker can render an empty state instead
 * of throwing. Cached in-memory for an hour per process.
 */
export async function listAvailableCountryPacks(): Promise<CountryPackListing[]> {
  const now = Date.now();
  if (cachedReleases && now - cachedReleasesAt < RELEASES_TTL_MS) {
    return cachedReleases;
  }
  try {
    const res = await fetch(RELEASES_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return [];
    const releases = (await res.json()) as GitHubRelease[];
    // Find the newest geo- release. The Releases API returns them
    // newest-first by default; pick the first one whose tag matches.
    const release = releases.find((r) => r.tag_name?.startsWith('geo-'));
    if (!release) return [];
    const snapshotDate = parseSnapshotFromTag(release.tag_name);
    const packs: CountryPackListing[] = [];
    for (const asset of release.assets ?? []) {
      const matched = isCountryAsset(asset.name);
      if (!matched) continue;
      packs.push({
        iso: matched.iso,
        name: countryNameForIso(matched.iso),
        sizeBytes: asset.size,
        snapshotDate,
        downloadUrl: asset.browser_download_url,
      });
    }
    packs.sort((a, b) => a.name.localeCompare(b.name));
    cachedReleases = packs;
    cachedReleasesAt = now;
    return packs;
  } catch {
    return [];
  }
}
