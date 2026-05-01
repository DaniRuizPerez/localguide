// Wikipedia REST + Action API wrappers for summary text, thumbnails, and
// historical timelines. No API key needed; Wikipedia is free + public.
// Matches the abort + timeout pattern from PoiService.

import { type TimelineEvent } from './LocalGuideService';

export { type TimelineEvent };

export interface WikipediaSummary {
  title: string;
  extract: string;
  description?: string;
  thumbnail?: { source: string; width: number; height: number };
  coordinates?: { lat: number; lon: number };
  pageUrl: string;
}

// 8 s matches PoiService; Wikipedia REST API usually replies in under 2 s on
// a healthy network but can stall on mobile radios in partial-attached state.
const FETCH_TIMEOUT_MS = 8000;
const NEGATIVE_TTL_MS = 60_000;
const LRU_MAX = 64;
const MAX_TIMELINE_EVENTS = 12;

// Wikipedia's User-Agent policy (https://meta.wikimedia.org/wiki/User-Agent_policy)
// rejects requests without an identifying UA — the REST API in particular
// returns HTTP 403 for the default React Native fetch UA. Send a contact-able
// identifier per the policy so requests are accepted.
const USER_AGENT = 'LocalGuide/1.0 (https://github.com/DaniRuizPerez/localguide)';

const REQUEST_HEADERS: HeadersInit = {
  'User-Agent': USER_AGENT,
  'Accept': 'application/json',
};

// ─── Minimal LRU cache ───────────────────────────────────────────────────────
// We only need two operations (get + set with eviction), so a Map suffices:
// Map iteration order is insertion order, so we delete+reinsert on access to
// keep the "most recently used" entry at the end.

type SummaryEntry =
  | { ok: true; data: WikipediaSummary; cachedAt: number }
  | { ok: false; cachedAt: number };

type HistoryEntry =
  | { ok: true; data: TimelineEvent[]; cachedAt: number }
  | { ok: false; cachedAt: number };

const summaryCache = new Map<string, SummaryEntry>();
const historyCache = new Map<string, HistoryEntry>();

function lruGet<T>(map: Map<string, T>, key: string): T | undefined {
  const entry = map.get(key);
  if (entry === undefined) return undefined;
  // Re-insert to mark as recently used.
  map.delete(key);
  map.set(key, entry);
  return entry;
}

function lruSet<T>(map: Map<string, T>, key: string, value: T): void {
  if (map.size >= LRU_MAX) {
    // Evict the oldest entry (first key in insertion order).
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.delete(key); // remove existing to reset insertion order
  map.set(key, value);
}

// ─── Shared abort helper ─────────────────────────────────────────────────────

// Combines the internal timeout signal with the caller's optional signal into
// a single signal that aborts when either fires.
function makeSignal(callerSignal?: AbortSignal): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let onCallerAbort: (() => void) | null = null;
  if (callerSignal) {
    onCallerAbort = () => controller.abort();
    callerSignal.addEventListener('abort', onCallerAbort);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (callerSignal && onCallerAbort) {
        callerSignal.removeEventListener('abort', onCallerAbort);
      }
    },
  };
}

// ─── summary() ──────────────────────────────────────────────────────────────

async function summary(
  title: string,
  opts?: { signal?: AbortSignal }
): Promise<WikipediaSummary | null> {
  const cacheKey = title.toLowerCase();
  const now = Date.now();
  const cached = lruGet(summaryCache, cacheKey);

  if (cached) {
    if (!cached.ok) {
      // Negative cache: only honour within TTL so transient blips don't stick.
      if (now - cached.cachedAt < NEGATIVE_TTL_MS) return null;
      // Stale negative: fall through and retry.
      summaryCache.delete(cacheKey);
    } else {
      return cached.data;
    }
  }

  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const { signal, cleanup } = makeSignal(opts?.signal);

  try {
    const response = await fetch(url, { signal, headers: REQUEST_HEADERS });
    if (response.status === 404) {
      lruSet(summaryCache, cacheKey, { ok: false, cachedAt: Date.now() });
      return null;
    }
    if (!response.ok) {
      lruSet(summaryCache, cacheKey, { ok: false, cachedAt: Date.now() });
      return null;
    }

    const data = (await response.json()) as {
      title?: string;
      extract?: string;
      description?: string;
      thumbnail?: { source: string; width: number; height: number };
      coordinates?: { lat: number; lon: number };
      content_urls?: { desktop?: { page?: string } };
    };

    const result: WikipediaSummary = {
      title: data.title ?? title,
      extract: data.extract ?? '',
      description: data.description,
      thumbnail: data.thumbnail,
      coordinates: data.coordinates,
      pageUrl: data.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    };

    lruSet(summaryCache, cacheKey, { ok: true, data: result, cachedAt: Date.now() });
    return result;
  } catch {
    lruSet(summaryCache, cacheKey, { ok: false, cachedAt: Date.now() });
    return null;
  } finally {
    cleanup();
  }
}

// ─── historySection() ────────────────────────────────────────────────────────

// Wikipedia section names that represent the history of a place.
const HISTORY_SECTION_NAMES = ['history', 'background', 'timeline', 'founding'];

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown | null> {
  try {
    const response = await fetch(url, { signal, headers: REQUEST_HEADERS });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function parseWikitextTimeline(wikitext: string): TimelineEvent[] {
  // Parse lines like:
  //   * 1893 – Stanford University founded.
  //   * In 1893, …
  //   * [[1893]] – …
  // Reuses the conservative year regex from LocalGuideService.parseTimeline.
  const events: TimelineEvent[] = [];

  for (const raw of wikitext.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    // Strip leading bullet / markup.
    const cleaned = line.replace(/^[*#:;]+\s*/, '').replace(/\[\[|\]\]/g, '');

    // Pattern 1: "<year> — <event>" or "<year> - <event>"
    const dashMatch = cleaned.match(/^(.+?)\s*[—\-–]\s*(.+)$/);
    if (dashMatch) {
      const year = dashMatch[1].trim();
      const event = dashMatch[2].trim();
      if (isYearLike(year) && event) {
        events.push({ year, event });
        if (events.length >= MAX_TIMELINE_EVENTS) break;
        continue;
      }
    }

    // Pattern 2: "In <year>, <event>"
    const inYearMatch = cleaned.match(/^[Ii]n\s+(\d{1,4}(?:s|st|nd|rd|th)?(?:\s+(?:BC|BCE|AD|CE))?)[,\s]\s*(.+)$/);
    if (inYearMatch) {
      const year = inYearMatch[1].trim();
      const event = inYearMatch[2].trim();
      if (event) {
        events.push({ year, event });
        if (events.length >= MAX_TIMELINE_EVENTS) break;
      }
    }
  }

  return events;
}

function isYearLike(s: string): boolean {
  return /\d/.test(s) || /(century|period|era|dynasty|age|bc|bce|ad|ce)/i.test(s);
}

async function historySection(
  title: string,
  opts?: { signal?: AbortSignal }
): Promise<TimelineEvent[] | null> {
  const cacheKey = title.toLowerCase();
  const now = Date.now();
  const cached = lruGet(historyCache, cacheKey);

  if (cached) {
    if (!cached.ok) {
      if (now - cached.cachedAt < NEGATIVE_TTL_MS) return null;
      historyCache.delete(cacheKey);
    } else {
      return cached.data;
    }
  }

  const { signal, cleanup } = makeSignal(opts?.signal);

  try {
    // Step 1: fetch section list to find the history section index.
    const sectionsUrl =
      `https://en.wikipedia.org/w/api.php?action=parse` +
      `&page=${encodeURIComponent(title)}` +
      `&prop=sections` +
      `&format=json&origin=*`;

    const sectionsData = (await fetchJson(sectionsUrl, signal)) as {
      parse?: {
        sections?: Array<{ index: string; line: string }>;
      };
    } | null;

    if (!sectionsData?.parse?.sections) {
      lruSet(historyCache, cacheKey, { ok: false, cachedAt: Date.now() });
      return null;
    }

    const sections = sectionsData.parse.sections;
    const historyEntry = sections.find((s) =>
      HISTORY_SECTION_NAMES.some((name) => s.line.toLowerCase().includes(name))
    );

    if (!historyEntry) {
      lruSet(historyCache, cacheKey, { ok: false, cachedAt: Date.now() });
      return null;
    }

    // Step 2: fetch the wikitext of that specific section.
    const wikitextUrl =
      `https://en.wikipedia.org/w/api.php?action=parse` +
      `&page=${encodeURIComponent(title)}` +
      `&prop=wikitext` +
      `&section=${encodeURIComponent(historyEntry.index)}` +
      `&format=json&origin=*`;

    const wikitextData = (await fetchJson(wikitextUrl, signal)) as {
      parse?: { wikitext?: { '*'?: string } };
    } | null;

    const wikitext = wikitextData?.parse?.wikitext?.['*'];
    if (!wikitext) {
      lruSet(historyCache, cacheKey, { ok: false, cachedAt: Date.now() });
      return null;
    }

    const events = parseWikitextTimeline(wikitext);
    if (events.length === 0) {
      lruSet(historyCache, cacheKey, { ok: false, cachedAt: Date.now() });
      return null;
    }

    lruSet(historyCache, cacheKey, { ok: true, data: events, cachedAt: Date.now() });
    return events;
  } catch {
    lruSet(historyCache, cacheKey, { ok: false, cachedAt: Date.now() });
    return null;
  } finally {
    cleanup();
  }
}

// ─── summarize() ─────────────────────────────────────────────────────────────

// Trims the extract at the last sentence boundary before maxChars to avoid
// blowing up Pixel 3 prefill cost (O(prompt tokens)).
function truncateAtSentence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  // Find the last sentence-ending punctuation before the cap.
  const lastEnd = Math.max(
    slice.lastIndexOf('.'),
    slice.lastIndexOf('!'),
    slice.lastIndexOf('?')
  );
  if (lastEnd > 0) {
    return slice.slice(0, lastEnd + 1).trim();
  }
  // No sentence boundary found: hard cut + ellipsis.
  return slice.trimEnd() + '…';
}

async function summarize(
  title: string,
  maxChars: number = 600,
  opts?: { signal?: AbortSignal }
): Promise<string | null> {
  const result = await summary(title, opts);
  if (!result || !result.extract) return null;
  return truncateAtSentence(result.extract.trim(), maxChars);
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const wikipediaService = {
  summary,
  historySection,
  summarize,

  // Exposed for tests that need a clean slate between runs.
  clearCache(): void {
    summaryCache.clear();
    historyCache.clear();
  },
};
