import { wikipediaSignals } from '../services/wikipediaSignals';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function pageviewsResponse(pages: Array<{ pageid: number; categories?: string[]; langlinks?: string[]; pageviews?: Record<string, number | null> }>) {
  const out: Record<string, unknown> = {};
  for (const p of pages) {
    out[String(p.pageid)] = {
      pageid: p.pageid,
      categories: (p.categories ?? []).map((title) => ({ title })),
      langlinks: (p.langlinks ?? []).map((lang) => ({ lang })),
      pageviews: p.pageviews ?? {},
    };
  }
  return { ok: true, json: async () => ({ query: { pages: out } }) };
}

describe('wikipediaSignals.fetchBatch', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    wikipediaSignals.__resetForTest();
  });

  it('returns parsed signals for each pageid: categories, langlink count, summed pageviews', async () => {
    mockFetch.mockResolvedValue(
      pageviewsResponse([
        {
          pageid: 1,
          categories: ['Category:Museums in California', 'Category:Stanford University'],
          langlinks: ['de', 'fr', 'es'],
          pageviews: { '2026-04-01': 100, '2026-04-02': 150, '2026-04-03': null },
        },
      ])
    );
    const out = await wikipediaSignals.fetchBatch([1]);
    const sig = out.get(1)!;
    expect(sig.categories).toEqual(['category:museums in california', 'category:stanford university']);
    expect(sig.langlinkCount).toBe(3);
    expect(sig.pageviews60d).toBe(250);
  });

  it('caches results so a second call with the same pageid does not hit fetch', async () => {
    mockFetch.mockResolvedValue(pageviewsResponse([{ pageid: 1, pageviews: { d1: 50 } }]));
    await wikipediaSignals.fetchBatch([1]);
    await wikipediaSignals.fetchBatch([1]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('batches at 50 ids per HTTP call', async () => {
    mockFetch.mockResolvedValue(pageviewsResponse([]));
    const ids = Array.from({ length: 120 }, (_, i) => i + 1);
    await wikipediaSignals.fetchBatch(ids);
    // 120 / 50 = 3 calls.
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('partial coverage: returns the pages the API sent back, omits the rest silently', async () => {
    mockFetch.mockResolvedValue(pageviewsResponse([{ pageid: 1, pageviews: { d1: 10 } }]));
    const out = await wikipediaSignals.fetchBatch([1, 2, 3]);
    expect(out.has(1)).toBe(true);
    expect(out.has(2)).toBe(false);
    expect(out.has(3)).toBe(false);
  });

  it('network error → returns empty map (caller falls back gracefully)', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));
    const out = await wikipediaSignals.fetchBatch([1, 2]);
    expect(out.size).toBe(0);
  });

  it('partial cache: ids already cached skip the network, only the rest are fetched', async () => {
    mockFetch.mockResolvedValueOnce(pageviewsResponse([{ pageid: 1, pageviews: { d1: 100 } }]));
    await wikipediaSignals.fetchBatch([1]);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    mockFetch.mockResolvedValueOnce(pageviewsResponse([{ pageid: 2, pageviews: { d1: 200 } }]));
    const out = await wikipediaSignals.fetchBatch([1, 2]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(out.get(1)!.pageviews60d).toBe(100);
    expect(out.get(2)!.pageviews60d).toBe(200);
  });

  it('AbortController: aborting before fetch completes resolves with empty map', async () => {
    mockFetch.mockImplementation(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    const ctrl = new AbortController();
    const promise = wikipediaSignals.fetchBatch([1, 2], ctrl.signal);
    ctrl.abort();
    const out = await promise;
    expect(out.size).toBe(0);
  });
});
