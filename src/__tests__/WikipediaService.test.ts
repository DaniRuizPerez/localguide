/**
 * Tests for WikipediaService.
 * Covers: summary happy-path, 404 → null, timeout → null, cache hit,
 * negative-cache TTL, historySection parsing, absent section → null,
 * abort propagation, and summarize() truncation.
 */

import { wikipediaService, WikipediaNetworkError, type WikipediaSummary } from '../services/WikipediaService';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function summaryResponse(overrides: Partial<WikipediaSummary> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      title: 'Stanford University',
      extract: 'Stanford University is a private research university in Stanford, California.',
      description: 'Private research university in Stanford, California',
      thumbnail: { source: 'https://example.com/thumb.jpg', width: 320, height: 240 },
      coordinates: { lat: 37.4275, lon: -122.1697 },
      content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Stanford_University' } },
      ...overrides,
    }),
  };
}

function notFoundResponse() {
  return { ok: false, status: 404, json: async () => ({}) };
}

function serverErrorResponse() {
  return { ok: false, status: 500, json: async () => ({}) };
}

function sectionsResponse(sections: Array<{ index: string; line: string }>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ parse: { sections } }),
  };
}

function wikitextResponse(wikitext: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ parse: { wikitext: { '*': wikitext } } }),
  };
}

// ─── summary() ───────────────────────────────────────────────────────────────

describe('WikipediaService.summary', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    wikipediaService.clearCache();
  });

  it('returns a WikipediaSummary on success', async () => {
    mockFetch.mockResolvedValue(summaryResponse());
    const result = await wikipediaService.summary('Stanford University');
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Stanford University');
    expect(result!.extract).toContain('private research university');
    expect(result!.thumbnail?.source).toBe('https://example.com/thumb.jpg');
    expect(result!.coordinates?.lat).toBe(37.4275);
    expect(result!.pageUrl).toBe('https://en.wikipedia.org/wiki/Stanford_University');
  });

  it('hits the REST summary endpoint with URL-encoded title', async () => {
    mockFetch.mockResolvedValue(summaryResponse());
    await wikipediaService.summary('Golden Gate Bridge');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toContain('https://en.wikipedia.org/api/rest_v1/page/summary/');
    expect(url).toContain('Golden%20Gate%20Bridge');
  });

  it('returns null on 404', async () => {
    mockFetch.mockResolvedValue(notFoundResponse());
    const result = await wikipediaService.summary('NonExistentPageXYZ');
    expect(result).toBeNull();
  });

  it('returns null on non-404 server error (safe variant)', async () => {
    mockFetch.mockResolvedValue(serverErrorResponse());
    const result = await wikipediaService.summary('Stanford University');
    expect(result).toBeNull();
  });

  it('returns null on network error (fetch rejects) (safe variant)', async () => {
    mockFetch.mockRejectedValue(new Error('network failure'));
    const result = await wikipediaService.summary('Stanford University');
    expect(result).toBeNull();
  });

  it('returns null on timeout (fetch rejects with AbortError) (safe variant)', async () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    mockFetch.mockRejectedValue(err);
    const result = await wikipediaService.summary('Stanford University');
    expect(result).toBeNull();
  });

  it('summaryStrict: throws WikipediaNetworkError on non-404 server error', async () => {
    mockFetch.mockResolvedValue(serverErrorResponse());
    await expect(wikipediaService.summaryStrict('Stanford University')).rejects.toBeInstanceOf(WikipediaNetworkError);
  });

  it('summaryStrict: throws WikipediaNetworkError on network error', async () => {
    mockFetch.mockRejectedValue(new Error('network failure'));
    await expect(wikipediaService.summaryStrict('Stanford University')).rejects.toBeInstanceOf(WikipediaNetworkError);
  });

  it('returns from cache without re-fetching on second call', async () => {
    mockFetch.mockResolvedValue(summaryResponse());
    const first = await wikipediaService.summary('Stanford University');
    const second = await wikipediaService.summary('Stanford University');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('cache lookup is case-insensitive', async () => {
    mockFetch.mockResolvedValue(summaryResponse());
    await wikipediaService.summary('Stanford University');
    mockFetch.mockClear();
    const result = await wikipediaService.summary('stanford university');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
  });

  it('negative result is cached and not re-fetched within TTL', async () => {
    mockFetch.mockResolvedValue(notFoundResponse());
    await wikipediaService.summary('NoSuchPage');
    mockFetch.mockClear();
    const result = await wikipediaService.summary('NoSuchPage');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('negative cache expires after TTL and triggers a fresh fetch', async () => {
    mockFetch.mockResolvedValue(notFoundResponse());
    await wikipediaService.summary('NoSuchPage');
    mockFetch.mockClear();

    // Fast-forward past the negative TTL (60 s).
    const realNow = Date.now;
    Date.now = () => realNow() + 61_000;
    try {
      mockFetch.mockResolvedValue(summaryResponse());
      const result = await wikipediaService.summary('NoSuchPage');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result).not.toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it('propagates caller abort signal (safe variant returns null)', async () => {
    const controller = new AbortController();
    // Fetch rejects when the internal signal aborts (mirrors what real fetch does).
    mockFetch.mockImplementation((_url: string, init?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        const err = Object.assign(new Error('AbortError'), { name: 'AbortError' });
        if (init?.signal?.aborted) { reject(err); return; }
        init?.signal?.addEventListener('abort', () => reject(err));
      });
    });
    const resultPromise = wikipediaService.summary('Stanford University', {
      signal: controller.signal,
    });
    controller.abort();
    const result = await resultPromise;
    expect(result).toBeNull();
  });

  it('falls back to synthetic pageUrl when content_urls is absent', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        title: 'Some Place',
        extract: 'Some extract.',
        // no content_urls
      }),
    });
    const result = await wikipediaService.summary('Some Place');
    expect(result?.pageUrl).toContain('en.wikipedia.org/wiki/');
  });
});

// ─── historySection() ────────────────────────────────────────────────────────

describe('WikipediaService.historySection', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    wikipediaService.clearCache();
  });

  it('returns parsed timeline events from a History section', async () => {
    mockFetch
      .mockResolvedValueOnce(
        sectionsResponse([
          { index: '1', line: 'Overview' },
          { index: '2', line: 'History' },
          { index: '3', line: 'Campus' },
        ])
      )
      .mockResolvedValueOnce(
        wikitextResponse(
          '* 1885 – Founded by Leland and Jane Stanford.\n' +
          '* 1891 – Opened to students.\n' +
          '* 1906 – Heavily damaged by San Francisco earthquake.\n'
        )
      );

    const result = await wikipediaService.historySection('Stanford University');
    expect(result).not.toBeNull();
    expect(result!.length).toBe(3);
    expect(result![0].year).toBe('1885');
    expect(result![0].event).toContain('Leland');
    expect(result![1].year).toBe('1891');
    expect(result![2].year).toBe('1906');
  });

  it('also matches "Background" as a history section heading', async () => {
    mockFetch
      .mockResolvedValueOnce(
        sectionsResponse([{ index: '1', line: 'Background' }])
      )
      .mockResolvedValueOnce(
        wikitextResponse('* 1776 – Declaration signed.\n')
      );
    const result = await wikipediaService.historySection('Independence Hall');
    expect(result).not.toBeNull();
    expect(result![0].year).toBe('1776');
  });

  it('also matches "Timeline" as a history section heading', async () => {
    mockFetch
      .mockResolvedValueOnce(
        sectionsResponse([{ index: '3', line: 'Timeline' }])
      )
      .mockResolvedValueOnce(
        wikitextResponse('* In 1902, the bridge was built.\n')
      );
    const result = await wikipediaService.historySection('Some Bridge');
    expect(result).not.toBeNull();
    expect(result![0].year).toBe('1902');
    expect(result![0].event).toContain('bridge was built');
  });

  it('returns null when no history-like section exists', async () => {
    mockFetch.mockResolvedValueOnce(
      sectionsResponse([
        { index: '1', line: 'Geography' },
        { index: '2', line: 'Demographics' },
      ])
    );
    const result = await wikipediaService.historySection('Some City');
    expect(result).toBeNull();
    // Should not have fetched the wikitext.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns null when sections API fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const result = await wikipediaService.historySection('Stanford University');
    expect(result).toBeNull();
  });

  it('returns null when wikitext API fails', async () => {
    mockFetch
      .mockResolvedValueOnce(
        sectionsResponse([{ index: '2', line: 'History' }])
      )
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const result = await wikipediaService.historySection('Stanford University');
    expect(result).toBeNull();
  });

  it('returns null when wikitext contains no parseable year entries', async () => {
    mockFetch
      .mockResolvedValueOnce(
        sectionsResponse([{ index: '2', line: 'History' }])
      )
      .mockResolvedValueOnce(
        wikitextResponse('This section has no dated entries.\nJust prose text here.\n')
      );
    const result = await wikipediaService.historySection('Stanford University');
    expect(result).toBeNull();
  });

  it('caps output at 12 events', async () => {
    const lines = Array.from(
      { length: 20 },
      (_, i) => `* ${1800 + i} – Event ${i}.\n`
    ).join('');
    mockFetch
      .mockResolvedValueOnce(
        sectionsResponse([{ index: '2', line: 'History' }])
      )
      .mockResolvedValueOnce(wikitextResponse(lines));
    const result = await wikipediaService.historySection('Some Place');
    expect(result).not.toBeNull();
    expect(result!.length).toBe(12);
  });

  it('caches positive results', async () => {
    mockFetch
      .mockResolvedValueOnce(sectionsResponse([{ index: '2', line: 'History' }]))
      .mockResolvedValueOnce(wikitextResponse('* 1900 – Something happened.\n'));
    await wikipediaService.historySection('Stanford University');
    mockFetch.mockClear();
    const second = await wikipediaService.historySection('Stanford University');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(second).not.toBeNull();
    expect(second![0].year).toBe('1900');
  });

  it('negative result is cached within TTL', async () => {
    mockFetch.mockResolvedValueOnce(
      sectionsResponse([{ index: '1', line: 'Geography' }])
    );
    await wikipediaService.historySection('NoDatedSection');
    mockFetch.mockClear();
    const result = await wikipediaService.historySection('NoDatedSection');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('propagates caller abort signal', async () => {
    const controller = new AbortController();
    // Fetch rejects when the internal signal aborts (mirrors what real fetch does).
    mockFetch.mockImplementation((_url: string, init?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        const err = Object.assign(new Error('AbortError'), { name: 'AbortError' });
        if (init?.signal?.aborted) { reject(err); return; }
        init?.signal?.addEventListener('abort', () => reject(err));
      });
    });
    const resultPromise = wikipediaService.historySection('Stanford University', {
      signal: controller.signal,
    });
    controller.abort();
    const result = await resultPromise;
    expect(result).toBeNull();
  });
});

// ─── summarize() ─────────────────────────────────────────────────────────────

describe('WikipediaService.summarize', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    wikipediaService.clearCache();
  });

  it('returns the extract when it is shorter than maxChars', async () => {
    const short = 'Short extract.';
    mockFetch.mockResolvedValue(
      summaryResponse({ extract: short } as Partial<WikipediaSummary>)
    );
    const result = await wikipediaService.summarize('Stanford University', 600);
    expect(result).toBe(short);
  });

  it('trims at the last sentence end before maxChars', async () => {
    // First sentence ends at index 30. Second sentence pushes past 40.
    const extract = 'First sentence ends here. Second sentence is longer and goes past the cap.';
    mockFetch.mockResolvedValue(
      summaryResponse({ extract } as Partial<WikipediaSummary>)
    );
    const result = await wikipediaService.summarize('Stanford University', 40);
    expect(result).toBe('First sentence ends here.');
    expect(result!.length).toBeLessThanOrEqual(40);
  });

  it('hard-cuts with ellipsis when no sentence boundary exists before cap', async () => {
    const extract = 'A very long extract with no sentence boundary anywhere near the cap limit here';
    mockFetch.mockResolvedValue(
      summaryResponse({ extract } as Partial<WikipediaSummary>)
    );
    const result = await wikipediaService.summarize('Stanford University', 20);
    expect(result).toMatch(/…$/);
    expect(result!.length).toBeLessThanOrEqual(21); // 20 chars + ellipsis (1 char)
  });

  it('uses default maxChars of 600', async () => {
    const longExtract = 'A'.repeat(700);
    mockFetch.mockResolvedValue(
      summaryResponse({ extract: longExtract } as Partial<WikipediaSummary>)
    );
    const result = await wikipediaService.summarize('Stanford University');
    // No sentence boundary, so hard cut at 600 + ellipsis.
    expect(result!.length).toBeLessThanOrEqual(601);
    expect(result).toMatch(/…$/);
  });

  it('returns null when summary() returns null', async () => {
    mockFetch.mockResolvedValue(notFoundResponse());
    const result = await wikipediaService.summarize('NonExistentPage');
    expect(result).toBeNull();
  });

  it('trims at ! and ? boundaries too', async () => {
    const extract = 'Amazing place! And then some more text that goes way past our small cap here.';
    mockFetch.mockResolvedValue(
      summaryResponse({ extract } as Partial<WikipediaSummary>)
    );
    const result = await wikipediaService.summarize('Stanford University', 20);
    expect(result).toBe('Amazing place!');
  });
});
