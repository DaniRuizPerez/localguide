/**
 * Table tests for onlineGuideService.decide().
 *
 * WikipediaService is fully mocked — no real network calls.
 * Tests cover every routing branch: llm-only (no title), llm-only (wiki null),
 * source-first (slow), source-first (fast+factual), rag (fast+conversational),
 * and the budget timeout path.
 */

import { onlineGuideService } from '../services/OnlineGuideService';
import { wikipediaService } from '../services/WikipediaService';
import type { WikipediaSummary } from '../services/WikipediaService';

// ─── Mock WikipediaService ────────────────────────────────────────────────────

jest.mock('../services/WikipediaService', () => ({
  wikipediaService: {
    summary: jest.fn(),
    historySection: jest.fn(),
    summarize: jest.fn(),
    clearCache: jest.fn(),
  },
}));

const mockSummary = wikipediaService.summary as jest.MockedFunction<
  typeof wikipediaService.summary
>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STANFORD_SUMMARY: WikipediaSummary = {
  title: 'Stanford Memorial Church',
  extract:
    'Stanford Memorial Church is a non-denominational church at Stanford University. ' +
    'It was built in 1903 to honor the memory of Leland Stanford. ' +
    'The church is notable for its mosaics and serves the Stanford community.',
  description: 'Church at Stanford University',
  thumbnail: { source: 'https://example.com/smc.jpg', width: 320, height: 240 },
  pageUrl: 'https://en.wikipedia.org/wiki/Stanford_Memorial_Church',
};

const GPS_PALO_ALTO = { latitude: 37.4275, longitude: -122.1697, placeName: 'Palo Alto, California' };

beforeEach(() => {
  mockSummary.mockReset();
});

// ─── No title resolved → llm-only ─────────────────────────────────────────────

describe('decide — no title resolves → llm-only', () => {
  it('returns llm-only with source ai-online when no poiTitle, no entity, no gps', async () => {
    const result = await onlineGuideService.decide({
      query: 'hello there',
      context: {},
      gps: null,
      perfClass: 'fast',
    });

    expect(result.mode).toBe('llm-only');
    expect(result.title).toBeNull();
    expect(result.reference).toBeNull();
    expect(result.sourceFirstText).toBeNull();
    expect(result.thumbnail).toBeNull();
    expect(result.source).toBe('ai-online');
    // summary should NOT have been called
    expect(mockSummary).not.toHaveBeenCalled();
  });
});

// ─── Title + Wikipedia returns null → llm-only ────────────────────────────────

describe('decide — Wikipedia returns null → llm-only', () => {
  it('returns llm-only with the resolved title when summary is null', async () => {
    mockSummary.mockResolvedValue(null);

    const result = await onlineGuideService.decide({
      query: 'Tell me about Stanford Memorial Church',
      context: {},
      gps: null,
      perfClass: 'fast',
    });

    expect(result.mode).toBe('llm-only');
    expect(result.title).toBe('Stanford Memorial Church');
    expect(result.reference).toBeNull();
    expect(result.sourceFirstText).toBeNull();
    expect(result.source).toBe('ai-online');
  });

  it('returns llm-only when summary has empty extract', async () => {
    mockSummary.mockResolvedValue({
      ...STANFORD_SUMMARY,
      extract: '',
    });

    const result = await onlineGuideService.decide({
      query: 'Tell me about Stanford Memorial Church',
      context: {},
      gps: null,
      perfClass: 'fast',
    });

    expect(result.mode).toBe('llm-only');
    expect(result.source).toBe('ai-online');
  });
});

// ─── Source-first: perfClass='slow' ───────────────────────────────────────────

describe('decide — perfClass=slow → source-first', () => {
  it('returns source-first with sourceFirstText set and reference null', async () => {
    mockSummary.mockResolvedValue(STANFORD_SUMMARY);

    const result = await onlineGuideService.decide({
      query: 'Tell me about Stanford Memorial Church',
      context: {},
      gps: null,
      perfClass: 'slow',
    });

    expect(result.mode).toBe('source-first');
    expect(result.title).toBe('Stanford Memorial Church');
    expect(result.source).toBe('wikipedia');
    expect(result.reference).toBeNull();
    expect(result.sourceFirstText).toBeTruthy();
    expect(result.sourceFirstText!.length).toBeLessThanOrEqual(400);
  });

  it('includes thumbnail URL when summary has one', async () => {
    mockSummary.mockResolvedValue(STANFORD_SUMMARY);

    const result = await onlineGuideService.decide({
      query: 'Tell me about Stanford Memorial Church',
      context: {},
      gps: null,
      perfClass: 'slow',
    });

    expect(result.thumbnail).toBe('https://example.com/smc.jpg');
  });

  it('thumbnail is null when summary has no thumbnail', async () => {
    mockSummary.mockResolvedValue({ ...STANFORD_SUMMARY, thumbnail: undefined });

    const result = await onlineGuideService.decide({
      query: 'Stanford Memorial Church',
      context: {},
      gps: null,
      perfClass: 'slow',
    });

    expect(result.thumbnail).toBeNull();
  });

  it('conversational query on slow device still takes source-first', async () => {
    mockSummary.mockResolvedValue(STANFORD_SUMMARY);

    const result = await onlineGuideService.decide({
      // Conversational, but perfClass=slow overrides
      query: 'Why is this church so famous among tourists?',
      context: { poiTitle: 'Stanford Memorial Church' },
      gps: null,
      perfClass: 'slow',
    });

    expect(result.mode).toBe('source-first');
    expect(result.source).toBe('wikipedia');
  });
});

// ─── Source-first: perfClass='fast' + factual query ───────────────────────────

describe('decide — perfClass=fast + factual query → source-first', () => {
  it('returns source-first for a short factual query on a fast device', async () => {
    mockSummary.mockResolvedValue(STANFORD_SUMMARY);

    const result = await onlineGuideService.decide({
      query: 'Stanford Memorial Church', // short, no opinion words
      context: {},
      gps: null,
      perfClass: 'fast',
    });

    expect(result.mode).toBe('source-first');
    expect(result.source).toBe('wikipedia');
    expect(result.reference).toBeNull();
    expect(result.sourceFirstText).toBeTruthy();
  });

  it('returns source-first for "What is the Stanford Memorial Church?"', async () => {
    mockSummary.mockResolvedValue(STANFORD_SUMMARY);

    const result = await onlineGuideService.decide({
      query: 'What is the Stanford Memorial Church?',
      context: {},
      gps: null,
      perfClass: 'fast',
    });

    expect(result.mode).toBe('source-first');
    expect(result.source).toBe('wikipedia');
  });

  it('uses poiTitle for the title even when query has an entity', async () => {
    mockSummary.mockResolvedValue(STANFORD_SUMMARY);

    await onlineGuideService.decide({
      query: 'Stanford',
      context: { poiTitle: 'Stanford Memorial Church' },
      gps: null,
      perfClass: 'fast',
    });

    // summary should have been called with the poiTitle, not the extracted entity
    expect(mockSummary).toHaveBeenCalledWith(
      'Stanford Memorial Church',
      expect.anything(),
    );
  });
});

// ─── RAG: perfClass='fast' + conversational query ─────────────────────────────

describe('decide — perfClass=fast + conversational query → rag', () => {
  it('returns rag with reference set and sourceFirstText null', async () => {
    mockSummary.mockResolvedValue(STANFORD_SUMMARY);

    const result = await onlineGuideService.decide({
      query: 'Why is it famous?', // "why" → conversational
      context: { poiTitle: 'Stanford Memorial Church' },
      gps: null,
      perfClass: 'fast',
    });

    expect(result.mode).toBe('rag');
    expect(result.source).toBe('wikipedia');
    expect(result.reference).toBe(STANFORD_SUMMARY.extract);
    expect(result.sourceFirstText).toBeNull();
    expect(result.title).toBe('Stanford Memorial Church');
  });

  it('returns rag for "How was it built?" query', async () => {
    mockSummary.mockResolvedValue(STANFORD_SUMMARY);

    const result = await onlineGuideService.decide({
      query: 'How was it built?',
      context: { poiTitle: 'Stanford Memorial Church' },
      gps: null,
      perfClass: 'fast',
    });

    expect(result.mode).toBe('rag');
  });

  it('returns rag for a long non-opinion query (over 60 chars = conversational)', async () => {
    mockSummary.mockResolvedValue(STANFORD_SUMMARY);

    const longQuery = 'What is the complete architectural description of the building on this site here';
    expect(longQuery.length).toBeGreaterThanOrEqual(60);

    const result = await onlineGuideService.decide({
      query: longQuery,
      context: { poiTitle: 'Stanford Memorial Church' },
      gps: null,
      perfClass: 'fast',
    });

    expect(result.mode).toBe('rag');
  });

  it('reference is the full extract (unclamped)', async () => {
    const longExtract = 'A'.repeat(2000); // over 1500 chars — clamp happens in buildNarratorPrompt
    mockSummary.mockResolvedValue({ ...STANFORD_SUMMARY, extract: longExtract });

    const result = await onlineGuideService.decide({
      query: 'Why is this place special?',
      context: { poiTitle: 'Stanford Memorial Church' },
      gps: null,
      perfClass: 'fast',
    });

    expect(result.mode).toBe('rag');
    // reference must be the full extract, NOT truncated here
    expect(result.reference).toBe(longExtract);
  });
});

// ─── perfClass='unknown' — treated same as fast for rag/source-first split ───

describe('decide — perfClass=unknown', () => {
  it('takes source-first on factual query (unknown does not force slow)', async () => {
    mockSummary.mockResolvedValue(STANFORD_SUMMARY);

    const result = await onlineGuideService.decide({
      query: 'Stanford Memorial Church',
      context: {},
      gps: null,
      perfClass: 'unknown',
    });

    // "unknown" is not 'slow', so slow override does NOT apply.
    // query is factual → source-first.
    expect(result.mode).toBe('source-first');
  });

  it('takes rag on conversational query when perfClass=unknown', async () => {
    mockSummary.mockResolvedValue(STANFORD_SUMMARY);

    const result = await onlineGuideService.decide({
      query: 'Why is this place so interesting?',
      context: { poiTitle: 'Stanford Memorial Church' },
      gps: null,
      perfClass: 'unknown',
    });

    expect(result.mode).toBe('rag');
  });
});

// ─── GPS-based title fallback ─────────────────────────────────────────────────

describe('decide — gps placeName fallback', () => {
  it('uses gps.placeName when no poiTitle and no entity in query', async () => {
    mockSummary.mockResolvedValue(STANFORD_SUMMARY);

    await onlineGuideService.decide({
      query: "what's nearby?",
      context: {},
      gps: GPS_PALO_ALTO,
      perfClass: 'fast',
    });

    expect(mockSummary).toHaveBeenCalledWith(
      'Palo Alto, California',
      expect.anything(),
    );
  });

  it('uses gps string when gps is passed as string', async () => {
    mockSummary.mockResolvedValue(STANFORD_SUMMARY);

    await onlineGuideService.decide({
      query: 'recommend something',
      context: {},
      gps: 'Palo Alto, California',
      perfClass: 'fast',
    });

    expect(mockSummary).toHaveBeenCalledWith(
      'Palo Alto, California',
      expect.anything(),
    );
  });
});

// ─── Budget timeout → llm-only ────────────────────────────────────────────────

describe('decide — budget timeout → llm-only', () => {
  it('returns llm-only when Wikipedia fetch exceeds budgetMs', async () => {
    // summary hangs until aborted, then resolves to null
    mockSummary.mockImplementation(
      (_title, opts) =>
        new Promise<WikipediaSummary | null>((resolve) => {
          opts?.signal?.addEventListener('abort', () => resolve(null));
        }),
    );

    const result = await onlineGuideService.decide({
      query: 'Stanford Memorial Church',
      context: {},
      gps: null,
      perfClass: 'fast',
      budgetMs: 50, // very tight budget
    });

    expect(result.mode).toBe('llm-only');
    expect(result.title).toBe('Stanford Memorial Church');
    expect(result.source).toBe('ai-online');
  });
});

// ─── sourceFirstText content ──────────────────────────────────────────────────

describe('decide — sourceFirstText content', () => {
  it('sourceFirstText contains only the first few sentences of the extract', async () => {
    const extract =
      'First sentence here. Second sentence follows. Third sentence is here. Fourth is omitted.';
    mockSummary.mockResolvedValue({ ...STANFORD_SUMMARY, extract });

    const result = await onlineGuideService.decide({
      query: 'Stanford Memorial Church',
      context: {},
      gps: null,
      perfClass: 'slow',
    });

    expect(result.sourceFirstText).toBeTruthy();
    // Should not contain the fourth sentence
    expect(result.sourceFirstText).not.toContain('Fourth is omitted');
    // Should contain the first sentence
    expect(result.sourceFirstText).toContain('First sentence here');
  });

  it('sourceFirstText is capped at 400 chars', async () => {
    const longSentence = 'This is a very long sentence that keeps going. '.repeat(20);
    mockSummary.mockResolvedValue({ ...STANFORD_SUMMARY, extract: longSentence });

    const result = await onlineGuideService.decide({
      query: 'Stanford Memorial Church',
      context: {},
      gps: null,
      perfClass: 'slow',
    });

    expect(result.sourceFirstText!.length).toBeLessThanOrEqual(400);
  });
});
