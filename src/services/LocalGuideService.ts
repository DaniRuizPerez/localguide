import {
  inferenceService,
  type GPSContext,
  type InferenceOptions,
  type StreamCallbacks,
  type StreamHandle,
} from './InferenceService';
import { runParsedStream, type AbortableTask } from './streamTask';
import { buildNarratorPrompt, formatCoordinates } from './promptBuilder';
import { localePromptDirective } from '../i18n';
import { narrationPrefs, narrationLengthDirective, type NarrationLength } from './NarrationPrefs';
import { guidePrefs, HIDDEN_GEMS_DIRECTIVE } from './GuidePrefs';

// Kept terse on purpose: prefill cost is O(prompt tokens), and on low-end CPU devices
// (Pixel 3-class) every 100 tokens of system prompt adds ~0.5–1 s before the first
// response token appears. Load-bearing rules: offline, coords-not-names, no invented
// specifics, narrator (not chat). If we need richer instructions later, do it via
// response post-processing rather than adding to the system prompt.
const SYSTEM_PROMPT = `You are an offline local tourist guide narrating a visitor's tour — not chatting with them. Share substantive, interesting knowledge (history, culture, architecture, traditions, the "why" behind things) in the user's language.
Rules:
- Open with a fact, detail, or story. Never greet, never ask questions, never offer follow-ups ("let me know…", "would you like…").
- 3–6 sentences of flowing narration, not a list.
- When a "Place:" line is given, the visitor is in that named place — narrate about it.
- If you don't know of a specifically notable spot at the exact location, narrate about the named place (the city or area) as a whole — its character, history, neighborhoods, culture, food traditions. Never say "there's nothing notable here" or that you lack information; always find something to share about the broader place.
- NEVER mention GPS, coordinates, latitude, longitude, or any raw numeric position in your response. Refer to places by name only. Do not read the Place or Coordinates lines back to the user.
- Never invent specific names, addresses, hours, prices, or distances. Phrase uncertain specifics generically ("a celebrated local architect", not a fabricated name).
- No live data — no "today", "now", weather, or current events.
- Stay on local topics (landmarks, history, culture, food, walking, etiquette); briefly decline anything else.`;

// Topic the user wants the guide to focus on. "everything" means no bias.
export type GuideTopic = 'everything' | 'history' | 'nature' | 'geography' | 'food' | 'culture';

const TOPIC_LABELS: Record<GuideTopic, string> = {
  everything: 'everything',
  history: 'history',
  nature: 'nature, wildlife, and landscape',
  geography: 'geography, landforms, and how the place is laid out',
  food: 'food, drink, and culinary traditions',
  culture: 'culture, customs, and everyday life',
};

function topicFocusDirective(topics: readonly GuideTopic[] | undefined): string | false {
  if (!topics || topics.length === 0 || topics.includes('everything')) return false;
  const labels = topics.map((t) => TOPIC_LABELS[t]).filter(Boolean);
  if (labels.length === 0) return false;
  if (labels.length === 1) {
    return `Focus area: ${labels[0]}. Lean your reply toward this topic unless the user asks about something else.`;
  }
  return `Focus areas: ${labels.join(', ')}. Lean your reply toward these topics unless the user asks about something else.`;
}

function lengthDirective(length?: NarrationLength): string {
  return narrationLengthDirective(length ?? narrationPrefs.get().length);
}

function buildPrompt(
  location: GPSContext | string,
  userQuery: string,
  topics?: readonly GuideTopic[],
  length?: NarrationLength
): string {
  return buildNarratorPrompt({
    system: SYSTEM_PROMPT,
    directives: [topicFocusDirective(topics), localePromptDirective(), lengthDirective(length)],
    place: location,
    cue: userQuery.trim() || 'Narrate what is interesting about this place.',
  });
}

export interface GuideResponse {
  text: string;
  locationUsed: GPSContext | string;
  durationMs: number;
}

function buildImagePrompt(
  location: GPSContext | string,
  userQuery: string,
  topics?: readonly GuideTopic[],
  length?: NarrationLength
): string {
  return buildNarratorPrompt({
    system: SYSTEM_PROMPT,
    directives: [topicFocusDirective(topics), localePromptDirective(), lengthDirective(length)],
    place: location,
    // Image path needs coords even when we have a place name — the model
    // uses them to disambiguate when the photo contents and named place
    // disagree.
    omitCoordsWithPlace: false,
    extraContext:
      "The visitor shared a photo from this spot. Identify what's in it and narrate its story — what it is, why it matters, the history and cultural background a local would share. Ground every claim in what's actually visible; use Place/Coordinates only to disambiguate. If image and location disagree, trust the image.",
    cue: userQuery.trim() || 'Narrate what is in this photo.',
  });
}

// Prompt for the offline nearby-places fallback. Intentionally sidesteps the
// narrator SYSTEM_PROMPT — we want a bare list here, not 3–6 sentences of
// flowing narration. Format is as strict as Gemma 3 1B will honor; we also
// post-parse defensively because 1B ignores format rules maybe 20% of the time.
function buildNearbyPlacesPrompt(
  location: GPSContext | string,
  radiusMeters: number,
  hiddenGems: boolean
): string {
  const radiusLabel =
    radiusMeters >= 1000
      ? `${(radiusMeters / 1000).toFixed(radiusMeters % 1000 === 0 ? 0 : 1)} km`
      : `${radiusMeters} m`;
  return buildNarratorPrompt({
    system: 'You are a local tourist expert helping a traveler find sights worth visiting.',
    directives: [hiddenGems && HIDDEN_GEMS_DIRECTIVE],
    place: location,
    // The radius task needs coords to anchor even when we have a place name.
    omitCoordsWithPlace: false,
    extraContext:
      `Task: list 6 TOURIST-WORTHY places WITHIN ${radiusLabel} of the visitor — a specific named attraction a traveler would actually go see.\n` +
      `Allowed categories: landmarks, historic sites, famous buildings, parks, gardens, plazas, museums, art galleries, universities, libraries, theaters, monuments, scenic viewpoints, notable neighborhoods.\n` +
      `NEVER include: chain stores (7-Eleven, Starbucks, McDonald's), gas stations, supermarkets, convenience stores, ZIP codes, highways, streets, administrative areas (countries, states, counties), generic schools, bus or metro stations, corporate headquarters.\n` +
      `Real places only; do not invent. If you don't know what's near this place, output nothing.\n` +
      `Output ONLY the place names, one per line. No numbering. No bullets. No descriptions. No intro or closing text.`,
  });
}

function parsePlaceList(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    // Strip common LLM-added prefixes: bullets, numbers, dashes, asterisks.
    .map((line) => line.replace(/^[\s*•\-–—]*(\d+[.)]\s*)?/, '').trim())
    // Quoted names ("Stanford University") — unwrap.
    .map((line) => line.replace(/^["'"']|["'"']$/g, '').trim())
    .filter((line) => {
      if (!line) return false;
      // Reject obvious non-name output: questions, sentences with verbs,
      // headers like "Here are some places:".
      if (line.length > 60) return false;
      if (/[.!?]$/.test(line) && line.split(' ').length > 5) return false;
      if (/^(here|sure|okay|ok|sorry|i )/i.test(line)) return false;
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

export type ListPlacesTask = AbortableTask<string[]>;

export interface ItineraryStop {
  title: string;
  note: string;
}

export type ItineraryTask = AbortableTask<ItineraryStop[]>;

export interface TimelineEvent {
  year: string;
  event: string;
}

export type TimelineTask = AbortableTask<TimelineEvent[]>;

export interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
}

export type QuizTask = AbortableTask<QuizQuestion[]>;

export interface QuizStreamHandlers {
  /** Fires once per fully-parsed question, in order. */
  onQuestion: (question: QuizQuestion, index: number) => void;
  /** Fires after the model finishes; receives every question emitted. */
  onDone: (questions: QuizQuestion[]) => void;
  onError: (message: string) => void;
}

export interface QuizStreamHandle {
  abort: () => Promise<void>;
}

function buildQuizPrompt(nearbyTitles: string[], count: number): string {
  const placesLine = nearbyTitles.length
    ? nearbyTitles.slice(0, 8).join(', ')
    : '(no specific list — use any widely-known facts about this area)';
  return buildNarratorPrompt({
    system: `You are writing a short local-trivia quiz for a visitor walking near these places: ${placesLine}.`,
    directives: [localePromptDirective()],
    extraContext:
      `Write exactly ${count} multiple-choice questions. Each question has 4 options labelled A, B, C, D, and ONE correct answer. ` +
      `Mix easy and medium difficulty. Ground questions in real, verifiable facts (history, geography, culture, architecture). ` +
      `Never invent facts. If you are not sure about a place, use a well-established general-knowledge fact about the area.\n\n` +
      `Output strictly in this format, with a blank line between questions:\n` +
      `Q: <question>\n` +
      `A: <option>\n` +
      `B: <option>\n` +
      `C: <option>\n` +
      `D: <option>\n` +
      `Correct: A\n` +
      `(no intro, no explanations, no closing remarks)`,
  });
}

// Single-question prompt used by the streaming generator. Gemma 4 E2B on a
// Pixel 3 reliably emits EOS after one well-formed Q/A/B/C/D/Correct block,
// so asking for "exactly 5" up front yielded only one. Generating one at a
// time avoids that failure mode at the cost of N prefill passes — acceptable
// because we only need 5 short ones.
//
// The "≤ 10 words per option" rule and explicit "≤ 80 characters" are
// load-bearing: without them Gemma occasionally writes a multi-sentence
// option that hits the per-call token limit before reaching B/C/D, leaving
// the parser with nothing to parse.
function buildSingleQuizPrompt(nearbyTitles: string[], previousQuestions: string[]): string {
  const placesLine = nearbyTitles.length
    ? nearbyTitles.slice(0, 8).join(', ')
    : '(no specific list — use any widely-known facts about this area)';
  const avoidLine = previousQuestions.length
    ? `Already-asked topics (do NOT repeat or rephrase these):\n` +
      previousQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n') +
      `\n\n`
    : '';
  // One-shot example with a concrete `Correct:` line is load-bearing for
  // Gemma 4 E2B: when only the format spec was given, the model treated
  // "Correct: A" as a literal value already provided and stopped after D
  // without emitting its own Correct line. A real example pins it down.
  return buildNarratorPrompt({
    system: `You are writing one local-trivia question for a visitor walking near these places: ${placesLine}.`,
    directives: [localePromptDirective()],
    extraContext:
      `${avoidLine}` +
      `Write ONE multiple-choice question with 4 options labelled A, B, C, D and ONE correct answer. ` +
      `Pick a topic different from any already-asked one above. ` +
      `Easy or medium difficulty. Ground it in a real, verifiable fact (history, geography, culture, architecture). ` +
      `Never invent facts. If unsure about a specific place, ask a general-knowledge question about the surrounding area or country instead.\n\n` +
      `Length rules — strict:\n` +
      `- Question line: at most 20 words.\n` +
      `- Each option: at most 10 words and 80 characters. A single noun phrase or short clause, not a sentence. No explanations.\n` +
      `- The four options must all be different.\n` +
      `- The final line MUST be exactly "Correct:" followed by the single letter (A, B, C, or D) of the right answer. Do not stop until you have written it.\n\n` +
      `Example of the exact format you must produce (one block, six lines):\n` +
      `Q: When was the Eiffel Tower completed?\n` +
      `A: 1789\n` +
      `B: 1889\n` +
      `C: 1945\n` +
      `D: 1900\n` +
      `Correct: B\n\n` +
      `Now write your own question in the same six-line format, then stop. ` +
      `No intro, no explanations, no second question.`,
  });
}

// Recognises a "this line starts a question" header. Strict prompt asks for
// `Q: …`, but Gemma 4 E2B sometimes drifts to `**Q:** …`, `Q1: …`,
// `Question 1: …`, or `1. …`, so the predicate is broader than the prompt.
const QUESTION_HEADER_RE = /^[*_`\s>]*(?:Q\s*\d*|Question\s*\d*)[.:)\]\s]|^[*_`\s>]*\d+[.):]\s+/i;
// The trailing [*_`\s]* swallows the closing markdown bold/italic markers
// when the header was wrapped (e.g. `**Question 1:**`).
const QUESTION_HEADER_STRIP_RE = /^[*_`\s>]*(?:Q\s*\d*|Question\s*\d*)[.:)\]\s][*_`\s]*/i;
const NUMBERED_HEADER_STRIP_RE = /^[*_`\s>]*\d+[.):][*_`\s]*/;

function stripQuestionHeader(line: string): string {
  if (QUESTION_HEADER_STRIP_RE.test(line)) {
    return line.replace(QUESTION_HEADER_STRIP_RE, '').replace(/[*_`]+$/, '').trim();
  }
  return line.replace(NUMBERED_HEADER_STRIP_RE, '').replace(/[*_`]+$/, '').trim();
}

function parseQuizBlock(block: string): QuizQuestion | null {
  const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 6) return null;
  const qLine = lines.find((l) => QUESTION_HEADER_RE.test(l));
  const q = qLine ? stripQuestionHeader(qLine) : undefined;
  const opts: Record<string, string> = {};
  for (const letter of ['A', 'B', 'C', 'D']) {
    // Accept "A:", "A.", "A)", and bold/markdown wrappers like "**A:**".
    const line = lines.find((l) =>
      new RegExp(`^[*_\\s]*${letter}[.:)]`, 'i').test(l)
    );
    if (!line) continue;
    opts[letter] = line
      .replace(new RegExp(`^[*_\\s]*${letter}[.:)]\\s*`, 'i'), '')
      .replace(/[*_`]+$/, '')
      .trim();
  }
  // Accept "Correct:" or "Answer:" — both are common Gemma drifts.
  const correctLine = lines.find((l) => /^[*_\s]*(correct|answer)\s*[:=]/i.test(l));
  const correctLetter = correctLine
    ?.replace(/^[*_\s]*(correct|answer)\s*[:=]\s*/i, '')
    .replace(/[*_`]+/g, '')
    .trim()
    .charAt(0)
    .toUpperCase();
  if (!q || !correctLetter) return null;
  if (!['A', 'B', 'C', 'D'].includes(correctLetter)) return null;
  if (!opts.A || !opts.B || !opts.C || !opts.D) return null;
  return {
    question: q,
    options: [opts.A, opts.B, opts.C, opts.D],
    correctIndex: { A: 0, B: 1, C: 2, D: 3 }[correctLetter as 'A' | 'B' | 'C' | 'D'],
  };
}

// Split a quiz response into one block per question. We split before every
// line that starts with "Q:", because Gemma 4 E2B doesn't reliably honour the
// "blank line between blocks" prompt rule on a Pixel 3 — when it doesn't, the
// old blank-line splitter merged everything into a single block and only the
// first Q ever parsed. The Q: marker is something the model cannot skip without
// also breaking the question itself, so it's a sturdier separator.
//
// While streaming, the trailing block may still be growing. We classify a
// block as `complete` when (a) another Q: follows it, or (b) it ends with a
// blank line (the historical "Correct: X\n\n" terminator). Otherwise it goes
// into `tail` and is held back until a final flush.
function splitQuizBlocks(text: string): { complete: string[]; tail: string } {
  // Split before any line that looks like a new question header. The header
  // predicate intentionally matches the same shapes parseQuizBlock accepts.
  const SPLIT_RE = /\r?\n(?=[*_`\s>]*(?:Q\s*\d*[.:)\]\s]|Question\s*\d*[.:)\]\s]|\d+[.):]\s))/i;
  const parts = text.split(SPLIT_RE).filter((p) => QUESTION_HEADER_RE.test(p.trimStart()));
  if (parts.length === 0) return { complete: [], tail: '' };
  const last = parts[parts.length - 1];
  const lastTerminated = /\n\s*\n\s*$/.test(last);
  if (parts.length === 1) {
    return lastTerminated ? { complete: [last], tail: '' } : { complete: [], tail: last };
  }
  const head = parts.slice(0, -1);
  return lastTerminated
    ? { complete: [...head, last], tail: '' }
    : { complete: head, tail: last };
}

function parseQuiz(text: string): QuizQuestion[] {
  const { complete, tail } = splitQuizBlocks(text);
  const blocks = tail ? [...complete, tail] : complete;
  const out: QuizQuestion[] = [];
  for (const block of blocks) {
    const q = parseQuizBlock(block);
    if (q) out.push(q);
    if (out.length >= 10) break;
  }
  return out;
}

function buildTimelinePrompt(poiTitle: string, location: GPSContext | string | null): string {
  const placeHint =
    location && typeof location !== 'string' && location.placeName
      ? `Context: in ${location.placeName}.`
      : typeof location === 'string'
      ? `Context: in ${location}.`
      : false;
  return buildNarratorPrompt({
    system:
      'You are a history-focused local guide. Produce a concise vertical timeline of notable events for this place, from earliest to most recent.',
    directives: [localePromptDirective()],
    // Timeline POI doesn't have real coords — pass the POI title as the Place.
    place: poiTitle,
    extraContext:
      (placeHint ? `${placeHint}\n\n` : '') +
      `Output 4–8 entries, strictly in this format:\n` +
      `YEAR — event description (one sentence)\n\n` +
      `Rules:\n` +
      `- Use a real year, century, or well-known period as YEAR (e.g. "1793", "1880s", "12th century").\n` +
      `- If you are not confident about a specific year, write the period instead.\n` +
      `- Never invent events. If you have fewer than 4 reliable entries, output only the ones you are confident in.\n` +
      `- No bullets, no numbering, no intro, no closing remarks.`,
  });
}

function parseTimeline(text: string): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // Expect "YEAR — event". Also accept bullets / numbering the model adds
    // despite instructions.
    const cleaned = line.replace(/^[\s•\-*]+/, '').replace(/^\d+[.)]\s*/, '');
    const match = cleaned.match(/^(.+?)\s*[—\-–]\s*(.+)$/);
    if (!match) continue;
    const year = match[1].trim();
    const event = match[2].trim();
    // Reject entries where "year" is clearly not a year/period (no digits and
    // no century word).
    if (!year) continue;
    if (!/\d/.test(year) && !/(century|period|era|dynasty|age|bc|bce|ad|ce)/i.test(year)) {
      continue;
    }
    if (!event) continue;
    events.push({ year, event });
  }
  return events.slice(0, 10);
}

function buildItineraryPrompt(
  location: GPSContext | string,
  durationHours: number,
  nearbyTitles: string[]
): string {
  // Feed the model real nearby POIs so it doesn't hallucinate, but also let
  // it drop or reorder them based on what actually fits the time budget.
  const optionList = nearbyTitles.length
    ? nearbyTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')
    : '(no list available — choose what makes sense near this place)';
  const count = durationHours <= 1.5 ? 3 : durationHours <= 5 ? 5 : 7;
  const placeRef =
    typeof location === 'string' ? location : location.placeName ?? formatCoordinates(location);
  return buildNarratorPrompt({
    system: `You are a local tour planner helping a visitor with ${durationHours} hour(s) near ${placeRef}.`,
    directives: [localePromptDirective()],
    extraContext:
      `Candidate stops (real places, ordered by proximity):\n${optionList}\n\n` +
      `Pick ${count} stops total in the best visit order for someone walking between them. ` +
      `Account for walking time and ~15 min at each stop. Drop the candidates that don't fit; ` +
      `prefer a coherent route (no backtracking) over ticking every box.\n` +
      `Output strictly in this format, one line per stop:\n` +
      `1. STOP NAME — one-sentence reason to visit\n` +
      `2. STOP NAME — one-sentence reason to visit\n` +
      `(no header, no intro, no summary, no bullets other than the numbered list)`,
  });
}

function parseItinerary(text: string): ItineraryStop[] {
  const stops: ItineraryStop[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // Expect "1. Title — note" or "1) Title - note".
    const match = line.match(/^\s*\d+[.)]\s*(.+?)\s*[—\-–]\s*(.+)$/);
    if (match) {
      const title = match[1].trim().replace(/^["'"]|["'"]$/g, '');
      const note = match[2].trim();
      if (title && note) stops.push({ title, note });
      continue;
    }
    // Fallback: number-only line like "1. Title" without a dash.
    const titleOnly = line.match(/^\s*\d+[.)]\s*(.+)$/);
    if (titleOnly) {
      const title = titleOnly[1].trim();
      if (title) stops.push({ title, note: '' });
    }
  }
  return stops.slice(0, 10);
}

export const localGuideService = {
  async initialize(): Promise<void> {
    return inferenceService.initialize();
  },

  /**
   * Offline-capable nearby-places lookup using the on-device model. Returns an
   * abortable task so callers can cancel if the user starts their own query
   * while generation is in flight — Gemma 3 1B takes ~5–10 s on a Pixel 3 for
   * a list this short, which is long enough to need an escape hatch.
   */
  listNearbyPlaces(location: GPSContext | string, radiusMeters: number = 1000): ListPlacesTask {
    const prompt = buildNearbyPlacesPrompt(
      location,
      radiusMeters,
      guidePrefs.get().hiddenGems
    );
    return runParsedStream(prompt, parsePlaceList, { maxTokens: 180 });
  },

  async ask(
    userQuery: string,
    location: GPSContext | string,
    options?: InferenceOptions
  ): Promise<GuideResponse> {
    const prompt = buildPrompt(location, userQuery);
    const start = Date.now();
    const text = await inferenceService.runInference(prompt, options);
    return {
      text: text.trim(),
      locationUsed: location,
      durationMs: Date.now() - start,
    };
  },

  async askWithImage(
    userQuery: string,
    location: GPSContext | string,
    imagePath: string,
    options?: InferenceOptions
  ): Promise<GuideResponse> {
    const prompt = buildImagePrompt(location, userQuery);
    const start = Date.now();
    const text = await inferenceService.runInference(prompt, { ...options, imagePath });
    return {
      text: text.trim(),
      locationUsed: location,
      durationMs: Date.now() - start,
    };
  },

  /**
   * Offline-capable itinerary planner. Streams the raw model output; the
   * promise resolves with the parsed ordered list of stops. Callers can
   * abort mid-flight (generation takes ~10–20 s on a Pixel 3 for 5 stops).
   */
  planItinerary(
    location: GPSContext | string,
    durationHours: number,
    nearbyTitles: string[] = []
  ): ItineraryTask {
    const prompt = buildItineraryPrompt(location, durationHours, nearbyTitles);
    return runParsedStream(prompt, parseItinerary, { maxTokens: 400 });
  },

  /**
   * Streams a historical timeline for a POI. Resolves with parsed
   * year/event pairs. Abortable.
   */
  buildTimeline(poiTitle: string, location: GPSContext | string | null): TimelineTask {
    const prompt = buildTimelinePrompt(poiTitle, location);
    return runParsedStream(prompt, parseTimeline, { maxTokens: 350 });
  },

  /**
   * Generate multiple-choice trivia questions about nearby places.
   */
  generateQuiz(nearbyTitles: string[], count: number = 5): QuizTask {
    const prompt = buildQuizPrompt(nearbyTitles, count);
    return runParsedStream(prompt, parseQuiz, { maxTokens: 700 });
  },

  /**
   * Streaming variant: emits each question via `handlers.onQuestion` as soon
   * as it has been generated. Implemented as N sequential single-question
   * inferences because Gemma 4 E2B on a Pixel 3 reliably emits EOS after one
   * well-formed Q/A/B/C/D/Correct block — asking for "exactly 5" up front
   * yielded only one. Each follow-up call passes the previous question texts
   * as a "do not repeat" list so the set stays varied.
   *
   * Per-call streaming still parses incrementally: once we see the next "Q:"
   * inside a block the previous block is complete, and a final flush catches
   * the last block. The same parser tolerates Gemma drifting to "Question 1:",
   * "Answer:", or markdown bold wrappers around the markers.
   */
  generateQuizStream(
    nearbyTitles: string[],
    count: number,
    handlers: QuizStreamHandlers
  ): QuizStreamHandle {
    const emitted: QuizQuestion[] = [];
    let aborted = false;
    let currentHandle: StreamHandle | null = null;

    const runOne = (): Promise<QuizQuestion | null> => {
      return new Promise((resolve, reject) => {
        if (aborted) return resolve(null);
        const prompt = buildSingleQuizPrompt(
          nearbyTitles,
          emitted.map((q) => q.question)
        );
        let fullText = '';
        let settledOne = false;

        inferenceService
          .runInferenceStream(
            prompt,
            {
              onToken: (delta) => {
                if (settledOne) return;
                fullText += delta;
              },
              onDone: () => {
                if (settledOne) return;
                settledOne = true;
                currentHandle = null;
                const parsed = parseQuiz(fullText);
                const q = parsed[0] ?? null;
                if (__DEV__ && !q) {
                  // eslint-disable-next-line no-console
                  console.warn(
                    `[quiz] failed to parse single-question reply (${fullText.length} chars). Raw:\n` +
                      fullText
                  );
                }
                resolve(q);
              },
              onError: (msg) => {
                if (settledOne) return;
                settledOne = true;
                currentHandle = null;
                reject(new Error(msg));
              },
            },
            // 220 was too tight: Gemma occasionally wrote a long option-A
            // and ran out of budget before emitting B/C/D, leaving the
            // parser with an unparseable half-block. 400 is comfortable for
            // a Q + 4 short options + Correct line.
            { maxTokens: 400 }
          )
          .then((handle) => {
            if (aborted || settledOne) {
              handle.abort();
              return;
            }
            currentHandle = handle;
          })
          .catch((err) => {
            if (settledOne) return;
            settledOne = true;
            reject(err instanceof Error ? err : new Error(String(err)));
          });
      });
    };

    (async () => {
      try {
        for (let i = 0; i < count; i++) {
          if (aborted) break;
          // Up to 2 attempts per slot. Gemma 4 E2B occasionally produces a
          // Q + 4 options without a Correct line and then EOSes — a single
          // retry usually clears the bad sample without doubling latency in
          // the common case.
          let q: QuizQuestion | null = null;
          for (let attempt = 0; attempt < 2; attempt++) {
            if (aborted) break;
            q = await runOne();
            if (q || aborted) break;
          }
          if (aborted) break;
          if (q) {
            emitted.push(q);
            handlers.onQuestion(q, emitted.length - 1);
          }
        }
      } catch (err) {
        if (!aborted) {
          handlers.onError(err instanceof Error ? err.message : String(err));
          return;
        }
      }
      if (!aborted) handlers.onDone(emitted);
    })();

    return {
      abort: async () => {
        if (aborted) return;
        aborted = true;
        if (currentHandle) {
          const h = currentHandle;
          currentHandle = null;
          await h.abort();
        }
      },
    };
  },

  async askStream(
    userQuery: string,
    location: GPSContext | string,
    callbacks: StreamCallbacks,
    topics?: readonly GuideTopic[]
  ): Promise<StreamHandle> {
    const prompt = buildPrompt(location, userQuery, topics);
    return inferenceService.runInferenceStream(prompt, callbacks);
  },

  async askWithImageStream(
    userQuery: string,
    location: GPSContext | string,
    imagePath: string,
    callbacks: StreamCallbacks,
    topics?: readonly GuideTopic[]
  ): Promise<StreamHandle> {
    const prompt = buildImagePrompt(location, userQuery, topics);
    return inferenceService.runInferenceStream(prompt, callbacks, { imagePath });
  },

  async dispose(): Promise<void> {
    return inferenceService.dispose();
  },
};
