// Orchestration layer for online-mode chat routing.
//
// Decides between three paths based on Wikipedia availability + device perf:
//   source-first — render Wikipedia extract directly (no LLM)
//   rag          — inject extract as reference into the LLM prompt
//   llm-only     — no Wikipedia grounding; run LLM with source='ai-online'
//
// All pure functions (resolveTitle, isFactualQuery) are exported for testing.
// decide() is async only because of the Wikipedia fetch.

import { wikipediaService } from './WikipediaService';
import type { GPSContext } from './InferenceService';
import type { Source } from '../components/SourceBadge';

// ─── Public types ────────────────────────────────────────────────────────────

export type RoutingMode = 'source-first' | 'rag' | 'llm-only';

export interface RoutingDecision {
  mode: RoutingMode;
  /** Wikipedia title resolved for the lookup, when applicable. */
  title: string | null;
  /** Wikipedia extract to inject as RAG reference (when mode === 'rag'). */
  reference: string | null;
  /** First 2-3 sentences of extract for source-first chat bubbles (when mode === 'source-first'). */
  sourceFirstText: string | null;
  /** Wikipedia thumbnail URL when available (for source-first UI). */
  thumbnail: string | null;
  /** The Source value to tag the message with. */
  source: Source;
}

export interface ConversationContext {
  /** Title of the most recently tapped POI in the conversation, if any. */
  poiTitle?: string | null;
}

// ─── Internal constants ──────────────────────────────────────────────────────

// Caps the source-first text at 400 chars (plan: Decision B).
const SOURCE_FIRST_MAX_CHARS = 400;

// Default budget for the Wikipedia race in decide().
const DEFAULT_BUDGET_MS = 1500;

// Opinion / explanation words that mark a query as conversational.
const OPINION_WORDS = ['why', 'how', 'should', 'tell me', 'explain', 'what makes', 'opinion', 'think'];

// Regex: two or more capitalized words (matches named entities like "Stanford Memorial Church").
// We look for the longest run of capitalized words to prefer the most specific entity.
// Both the first and subsequent words allow apostrophes so possessives like "Fisherman's Wharf" work.
const CAPITALIZED_WORDS_RE = /[A-Z][a-z']+(?:\s+[A-Z][a-z']+)+/g;

// ─── LLM-only sentinel ───────────────────────────────────────────────────────

function llmOnlyResult(title: string | null): RoutingDecision {
  return {
    mode: 'llm-only',
    title,
    reference: null,
    sourceFirstText: null,
    thumbnail: null,
    source: 'ai-online',
  };
}

// ─── resolveTitle ────────────────────────────────────────────────────────────

/**
 * Pure function: pick a Wikipedia lookup title from the available signals.
 *
 * Priority order (per Decision C of the plan):
 *   1. context.poiTitle — POI tap context, Wikipedia-canonical.
 *   2. Longest capitalized-word run of ≥ 2 words extracted from query.
 *   3. gps.placeName (if GPSContext) or gps itself (if string).
 *   4. null — no grounding attempted.
 */
function resolveTitle(
  query: string,
  context: ConversationContext,
  gps: GPSContext | string | null,
): string | null {
  // 1. POI tap wins unconditionally.
  if (context.poiTitle) return context.poiTitle;

  // 2. Extract the longest capitalized-word sequence from the query.
  const matches = query.match(CAPITALIZED_WORDS_RE);
  if (matches && matches.length > 0) {
    // Pick the longest match (most specific entity).
    const longest = matches.reduce((a, b) => (b.length > a.length ? b : a));
    return longest;
  }

  // 3. Reverse-geocoded place name.
  if (typeof gps === 'string' && gps.length > 0) return gps;
  if (gps !== null && typeof gps === 'object' && gps.placeName) return gps.placeName;

  // 4. No title resolved.
  return null;
}

// ─── isFactualQuery ──────────────────────────────────────────────────────────

/**
 * Pure function: classify a query as factual (short, no opinion words) or
 * conversational.
 *
 * Returns true when:
 *   - query.length < 60, AND
 *   - query (lowercased) contains none of the opinion/explanation words.
 */
function isFactualQuery(query: string): boolean {
  if (query.length >= 60) return false;
  const lower = query.toLowerCase();
  return !OPINION_WORDS.some((word) => lower.includes(word));
}

// ─── First 2-3 sentences ─────────────────────────────────────────────────────

/**
 * Extract the first 2–3 sentences from text, capped at SOURCE_FIRST_MAX_CHARS.
 * Splits on `. `, `! `, or `? ` (followed by space or end-of-string) so we
 * don't cut inside abbreviations like "St. Mary's".
 */
function firstSentences(text: string): string {
  // Split on sentence-ending punctuation followed by whitespace or end.
  // The negative lookbehind `(?<![A-Z])` skips initials like "Charles A. "
  // so we don't truncate Wikipedia summaries mid-name.
  const sentenceEnd = /(?<![A-Z])[.!?](?:\s|$)/g;
  const sentences: string[] = [];
  let lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = sentenceEnd.exec(text)) !== null) {
    const sentence = text.slice(lastIndex, match.index + 1).trim();
    if (sentence) sentences.push(sentence);
    lastIndex = match.index + match[0].length;
    if (sentences.length >= 3) break;
  }

  // If fewer than 3 delimiters found, take the remainder.
  if (sentences.length < 3 && lastIndex < text.length) {
    const remainder = text.slice(lastIndex).trim();
    if (remainder) sentences.push(remainder);
  }

  const joined = sentences.join(' ');
  if (joined.length <= SOURCE_FIRST_MAX_CHARS) return joined;

  // Cap at SOURCE_FIRST_MAX_CHARS at the last sentence boundary.
  const slice = joined.slice(0, SOURCE_FIRST_MAX_CHARS);
  const lastEnd = Math.max(
    slice.lastIndexOf('.'),
    slice.lastIndexOf('!'),
    slice.lastIndexOf('?'),
  );
  if (lastEnd > 0) return slice.slice(0, lastEnd + 1).trim();
  return slice.trimEnd() + '…';
}

// ─── decide ──────────────────────────────────────────────────────────────────

/**
 * Decide the routing for a chat query, fetching Wikipedia within budgetMs.
 *
 * Does NOT depend on DevicePerf directly — accepts perfClass as a parameter
 * so the function remains pure and testable without the perf service (W2
 * will read DevicePerf and pass the class in).
 */
async function decide(params: {
  query: string;
  context: ConversationContext;
  gps: GPSContext | string | null;
  perfClass: 'fast' | 'slow' | 'unknown';
  budgetMs?: number;
}): Promise<RoutingDecision> {
  const { query, context, gps, perfClass, budgetMs = DEFAULT_BUDGET_MS } = params;

  // Step 1: resolve the title.
  const title = resolveTitle(query, context, gps);
  if (!title) return llmOnlyResult(null);

  // Step 2: race WikipediaService.summary against the budget.
  const inner = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => {
      inner.abort();
      resolve(null);
    }, budgetMs);
  });

  const fetchPromise: Promise<Awaited<ReturnType<typeof wikipediaService.summary>>> =
    wikipediaService.summary(title, { signal: inner.signal }).catch(() => null);

  let wikiSummary: Awaited<ReturnType<typeof wikipediaService.summary>>;
  try {
    const result = await Promise.race([fetchPromise, timeoutPromise]);
    wikiSummary = result;
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
    // Abort the inner controller in case fetchPromise won the race but
    // timeoutPromise's setTimeout is still pending.
    inner.abort();
  }

  // Step 3: no summary → LLM-only.
  if (!wikiSummary || !wikiSummary.extract) {
    return llmOnlyResult(title);
  }

  const { extract, thumbnail } = wikiSummary;
  const thumbnailUrl = thumbnail?.source ?? null;

  // Step 4: pick between source-first and RAG.
  const useSourceFirst = perfClass === 'slow' || isFactualQuery(query);

  if (useSourceFirst) {
    return {
      mode: 'source-first',
      title,
      reference: null,
      sourceFirstText: firstSentences(extract),
      thumbnail: thumbnailUrl,
      source: 'wikipedia',
    };
  }

  // RAG path (fast + conversational).
  return {
    mode: 'rag',
    title,
    reference: extract,   // NOT clamped here; buildNarratorPrompt clamps via referenceMaxChars
    sourceFirstText: null,
    thumbnail: thumbnailUrl,
    source: 'wikipedia',
  };
}

// ─── Singleton export ────────────────────────────────────────────────────────

export const onlineGuideService = {
  resolveTitle,
  isFactualQuery,
  decide,
};
