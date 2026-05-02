// Batched fetcher for Wikipedia ranking signals — categories, langlink count,
// and recent pageviews — keyed by Wikipedia pageid. The composite ranker in
// `poiRanking.ts` consumes these to push tourist-y, popular pages above
// long-but-boring corporate articles.
//
// MediaWiki API quirks we work around:
//   • `pageids` accepts at most 50 ids per call → batch larger inputs.
//   • `prop=pageviews&pvipdays=60` returns daily counts; we sum them server-side
//     by reading the `pageviews` map.
//   • `prop=categories|langlinks` requires `cllimit=max&lllimit=max` to avoid
//     the default 10-item cap.

const ENDPOINT = 'https://en.wikipedia.org/w/api.php';
const PVDAYS = 60;
const BATCH_SIZE = 50;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
// Conservative timeout — slow cell networks shouldn't block ranking forever.
const FETCH_TIMEOUT_MS = 8000;

export interface WikipediaSignals {
  /** Lower-cased category names ("category:museums in palo alto, california"). */
  categories: string[];
  /** Number of language editions this article has been translated into. */
  langlinkCount: number;
  /** Sum of daily pageviews over the last PVDAYS days. */
  pageviews60d: number;
}

interface CacheEntry {
  signals: WikipediaSignals;
  fetchedAt: number;
}

const cache = new Map<number, CacheEntry>();

function pruneCache(): void {
  if (cache.size <= CACHE_MAX_ENTRIES) return;
  // Map iteration is insertion-ordered in JS, so the oldest entries are
  // first. Drop until we're back under the cap.
  const overflow = cache.size - CACHE_MAX_ENTRIES;
  let dropped = 0;
  for (const key of cache.keys()) {
    cache.delete(key);
    dropped += 1;
    if (dropped >= overflow) break;
  }
}

interface RawPage {
  pageid: number;
  categories?: Array<{ title: string }>;
  langlinks?: Array<{ lang: string }>;
  pageviews?: Record<string, number | null>;
}

interface RawResponse {
  query?: { pages?: Record<string, RawPage> };
  continue?: unknown;
}

function summarize(page: RawPage): WikipediaSignals {
  const pvMap = page.pageviews ?? {};
  let pageviews60d = 0;
  for (const v of Object.values(pvMap)) {
    if (typeof v === 'number') pageviews60d += v;
  }
  return {
    categories: (page.categories ?? []).map((c) => c.title.toLowerCase()),
    langlinkCount: (page.langlinks ?? []).length,
    pageviews60d,
  };
}

async function fetchOneBatch(
  pageIds: number[],
  signal?: AbortSignal
): Promise<Map<number, WikipediaSignals>> {
  const url =
    `${ENDPOINT}?action=query` +
    `&pageids=${encodeURIComponent(pageIds.join('|'))}` +
    `&prop=categories|langlinks|pageviews` +
    `&cllimit=max&lllimit=max` +
    `&pvipdays=${PVDAYS}` +
    `&format=json&origin=*`;

  const localController = new AbortController();
  const timeoutId = setTimeout(() => localController.abort(), FETCH_TIMEOUT_MS);
  // Forward an upstream abort signal if one was supplied.
  if (signal) {
    if (signal.aborted) localController.abort();
    else signal.addEventListener('abort', () => localController.abort(), { once: true });
  }

  try {
    const res = await fetch(url, {
      signal: localController.signal,
      headers: { 'User-Agent': 'LocalGuide/1.0 (https://github.com/DaniRuizPerez/localguide)' },
    });
    if (!res.ok) return new Map();
    const data = (await res.json()) as RawResponse;
    const pages = data.query?.pages ?? {};
    const out = new Map<number, WikipediaSignals>();
    for (const page of Object.values(pages)) {
      out.set(page.pageid, summarize(page));
    }
    return out;
  } catch {
    // Network / timeout / abort — best-effort; return what we already cached.
    return new Map();
  } finally {
    clearTimeout(timeoutId);
  }
}

export const wikipediaSignals = {
  /**
   * Fetch ranking signals for the given pageids, returning a map keyed by id.
   * Cache-first: pageids whose entries are warm in cache skip the network.
   * Batches network requests at 50 ids per HTTP call.
   *
   * Pages whose request errored or whose response omitted them are simply
   * absent from the returned map — callers must tolerate partial coverage.
   */
  async fetchBatch(pageIds: number[], signal?: AbortSignal): Promise<Map<number, WikipediaSignals>> {
    const out = new Map<number, WikipediaSignals>();
    const now = Date.now();
    const toFetch: number[] = [];

    for (const id of pageIds) {
      const entry = cache.get(id);
      if (entry && now - entry.fetchedAt < CACHE_TTL_MS) {
        out.set(id, entry.signals);
      } else {
        toFetch.push(id);
      }
    }

    if (toFetch.length === 0) return out;

    // Split into batches of BATCH_SIZE ids each.
    const batches: number[][] = [];
    for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
      batches.push(toFetch.slice(i, i + BATCH_SIZE));
    }
    const batchResults = await Promise.all(batches.map((b) => fetchOneBatch(b, signal)));

    for (const result of batchResults) {
      for (const [id, sig] of result.entries()) {
        cache.set(id, { signals: sig, fetchedAt: now });
        out.set(id, sig);
      }
    }
    pruneCache();

    return out;
  },

  /** Test hook. */
  __resetForTest(): void {
    cache.clear();
  },
};
