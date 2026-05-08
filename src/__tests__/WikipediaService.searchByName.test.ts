/**
 * Tests for WikipediaService.searchByName — the free fuzzy fallback that
 * pipes a colloquial name through Wikipedia's `opensearch` endpoint and
 * then through the existing `summary()` for the rich payload.
 */

import { wikipediaService, WikipediaNetworkError } from '../services/WikipediaService';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function opensearchHit(title: string) {
  return {
    ok: true,
    status: 200,
    json: async () => [
      'query',
      [title],
      ['short description'],
      [`https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`],
    ],
  };
}

function opensearchEmpty() {
  return {
    ok: true,
    status: 200,
    json: async () => ['query', [], [], []],
  };
}

function opensearchError() {
  return { ok: false, status: 500, json: async () => ({}) };
}

function summaryResponse(title: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      title,
      extract: `${title} is a place.`,
      description: 'short description',
      content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}` } },
    }),
  };
}

describe('WikipediaService.searchByName', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    wikipediaService.clearCache();
  });

  it('resolves a colloquial name via opensearch then fetches the summary', async () => {
    // First call → opensearch returns the canonical title.
    // Second call → summary returns the rich payload.
    mockFetch
      .mockResolvedValueOnce(opensearchHit('Cantor Center for Visual Arts'))
      .mockResolvedValueOnce(summaryResponse('Cantor Center for Visual Arts'));

    const result = await wikipediaService.searchByName('Cantor Arts Center');

    expect(result).not.toBeNull();
    expect(result!.title).toBe('Cantor Center for Visual Arts');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const opensearchUrl: string = mockFetch.mock.calls[0][0];
    expect(opensearchUrl).toContain('action=opensearch');
    expect(opensearchUrl).toContain('Cantor%20Arts%20Center');
  });

  it('returns null when opensearch finds no matches (no second call)', async () => {
    mockFetch.mockResolvedValueOnce(opensearchEmpty());

    const result = await wikipediaService.searchByName('zzz definitely not a real place zzz');

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns null on opensearch HTTP error (safe variant)', async () => {
    mockFetch.mockResolvedValueOnce(opensearchError());

    const result = await wikipediaService.searchByName('Palo Alto');
    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('searchByNameStrict: throws WikipediaNetworkError on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce(opensearchError());

    await expect(wikipediaService.searchByNameStrict('Palo Alto')).rejects.toBeInstanceOf(WikipediaNetworkError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('forwards the AbortSignal to the underlying fetch', async () => {
    const controller = new AbortController();
    mockFetch
      .mockResolvedValueOnce(opensearchHit('Stanford Memorial Church'))
      .mockResolvedValueOnce(summaryResponse('Stanford Memorial Church'));

    await wikipediaService.searchByName('Mem Chu', { signal: controller.signal });

    expect(mockFetch).toHaveBeenCalled();
    // Each fetch call receives a signal (combined with the timeout signal),
    // so we just assert a signal is present on every call.
    for (const call of mockFetch.mock.calls) {
      const init = call[1] as { signal?: AbortSignal };
      expect(init?.signal).toBeDefined();
    }
  });

  it('returns null on empty/whitespace query without hitting fetch', async () => {
    const result = await wikipediaService.searchByName('   ');
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
