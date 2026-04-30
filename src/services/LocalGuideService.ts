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
  // Extract a human-readable city/place name so the model is grounded in the
  // user's actual location rather than generating generic hallucinated names.
  const cityLabel: string =
    typeof location === 'string'
      ? location
      : (location as GPSContext).placeName ?? '';
  const cityPhrase = cityLabel ? ` IN ${cityLabel}` : '';
  return buildNarratorPrompt({
    system: 'You are a local tourist expert helping a traveler find sights worth visiting.',
    directives: [hiddenGems && HIDDEN_GEMS_DIRECTIVE],
    place: location,
    // The radius task needs coords to anchor even when we have a place name.
    omitCoordsWithPlace: false,
    extraContext:
      `Task: list up to 6 TOURIST-WORTHY places${cityPhrase} WITHIN ${radiusLabel} of the visitor — specific named attractions a traveler would actually go see.\n` +
      `Allowed categories: landmarks, historic sites, famous buildings, parks, gardens, plazas, museums, art galleries, universities, libraries, theaters, monuments, scenic viewpoints, notable neighborhoods.\n` +
      `NEVER include: chain stores (7-Eleven, Starbucks, McDonald's), gas stations, supermarkets, convenience stores, ZIP codes, highways, streets, administrative areas (countries, states, counties), generic schools, bus or metro stations, corporate headquarters.\n` +
      `Output ONLY real, named places that genuinely exist${cityPhrase}. Output up to 6 well-known real places — if you don't know any, output the city's most famous landmarks instead. Real, named places only. Do not invent or guess names.\n` +
      `Output ONLY the place names, one per line. No numbering. No bullets. No markdown. No descriptions. No intro or closing text.`,
  });
}

function parsePlaceList(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    // Strip common LLM-added prefixes: bullets, numbers, dashes, asterisks.
    .map((line) => line.replace(/^[\s*•\-–—]*(\d+[.)]\s*)?/, '').trim())
    // Strip markdown bold/emphasis that Gemma wraps around names:
    // **Stonewall Historic District** → Stonewall Historic District
    // *City Hall*, __Central Park__, _The Foundry_ → plain text
    .map((line) => stripMarkdownEmphasis(line).trim())
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

// Singleton holding an in-flight quiz prefetch — populated by ChatScreen
// when the home screen has settled and the model is idle, drained by
// QuizModal on open. Keyed by location + first-N nearby titles so we don't
// hand a Palo Alto prefetch to a user who just teleported to Lisbon. There
// is at most one prefetch live at a time; opening a new prefetch for a
// different key aborts the previous one.
interface PrefetchObserver {
  onQuestion: (question: QuizQuestion, index: number) => void;
  onDone: (questions: QuizQuestion[]) => void;
  onError: (message: string) => void;
}
interface QuizPrefetchEntry {
  key: string;
  questions: QuizQuestion[];
  stream: QuizStreamHandle | null;
  observers: PrefetchObserver[];
  done: boolean;
  doneAll: QuizQuestion[];
  errorMsg: string | null;
}
let activePrefetch: QuizPrefetchEntry | null = null;

function quizPrefetchKey(nearbyTitles: string[], locationLabel: string | undefined): string {
  // First three titles are enough to detect a meaningfully different POI
  // mix without making the key brittle to ordering churn deeper in the list.
  return `${locationLabel ?? '?'}|${nearbyTitles.slice(0, 3).join('||')}`;
}

// Strip markdown emphasis (**, *, _) Gemma sprinkles around field labels —
// "**Q:**", "*Correct:*", etc. Run on a per-line basis before regex matching.
function stripMarkdownEmphasis(line: string): string {
  return line.replace(/^[*_]+/, '').replace(/[*_]+$/, '').replace(/\*\*/g, '').replace(/__/g, '');
}

// Render the location grounding line(s) shared by both the batch prompt
// (generateQuiz) and the per-question prompt (generateQuizStream). The
// difference between "near these places" and "in <city>" matters: when we
// only have POI names, Gemma 3 1B/Gemma 4 E2B can drift to a famous landmark
// elsewhere ("near Stanford" → trivia about Cambridge). The explicit
// `Location:` line + the no-substitution rule below clamp it to the user's
// real region.
function quizGroundingBlock(
  nearbyTitles: string[],
  locationLabel: string | undefined
): string {
  const places = nearbyTitles.slice(0, 8);
  const lines: string[] = [];
  if (locationLabel && locationLabel.trim()) {
    lines.push(`Location: ${locationLabel.trim()}`);
  }
  if (places.length) {
    lines.push(`Nearby places: ${places.join(', ')}`);
  } else {
    lines.push('Nearby places: (no specific list — rely on the Location above)');
  }
  return lines.join('\n');
}

// Anti-drift directive shared by both quiz prompts. The "NEVER substitute a
// famous landmark from a different country" line is the load-bearing one:
// without it, Gemma reaches for Rome/Paris when it doesn't know Palo Alto.
const QUIZ_GROUNDING_RULES =
  `Ground every question in the Location and Nearby places above — never substitute a famous landmark or city from a different region or country. ` +
  // Confidence rule + widening cascade. The 1B on-device model is not great
  // at calibration, but this nudge moves the failure mode from "invent a
  // detail about X" to "fall back to a fact about the broader region",
  // which is far less wrong. Order matters: try the user's specific place
  // first, then concentric supersets, ending at US-level general knowledge
  // that is almost certainly true.
  `Only ask about facts you are highly confident are correct. If you are not sure of a specific detail about the Location, widen the scope step by step until you reach a fact you are confident about: the immediate place → its surrounding metro area (e.g. Bay Area for Palo Alto) → the larger region (Northern California) → the state/province → the country. Never invent details to keep the question local. ` +
  `Use real, verifiable facts only — never invent specific names, dates, or numbers.`;

function buildQuizPrompt(
  nearbyTitles: string[],
  count: number,
  locationLabel?: string
): string {
  const grounding = quizGroundingBlock(nearbyTitles, locationLabel);
  return buildNarratorPrompt({
    system: `You are writing a short local-trivia quiz for a visitor.`,
    directives: [localePromptDirective()],
    extraContext:
      `${grounding}\n\n` +
      `Write exactly ${count} multiple-choice questions. Each question has 4 options labelled A, B, C, D, and ONE correct answer. ` +
      `Mix easy and medium difficulty. Each question must cover a DIFFERENT topic (no two questions about the same place, person, or fact). ` +
      `${QUIZ_GROUNDING_RULES}\n\n` +
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

/**
 * Per-question prompt used by the streaming generator. Receives the texts of
 * questions already asked this run so we can demand a fresh topic.
 *
 * Why per-question: with one batch prompt the small on-device model often
 * "echoes" the first question 5 times (we've seen identical Q1=Q2=Q3 on
 * Pixel 3). Splitting each question into its own inference call lets us
 * (a) inject the previous questions into the prompt as a do-not-repeat list
 * and (b) reject and retry duplicates at the JS layer.
 */
// Topic angles rotated through the per-question prompts. The 1B on-device
// model can't reliably follow a "do not repeat" instruction (we observed
// it emit identical Q0=Q1=Q2 even with the previous questions listed and
// labeled FORBIDDEN), so instead we hand it a fundamentally different
// *positive* request each slot. Asking for "a question about HISTORY"
// then "about FOOD" produces variety because each prompt is genuinely
// asking for a different thing — the model doesn't need to reason about
// what to avoid, only what to write about.
const QUIZ_TOPIC_ANGLES: ReadonlyArray<{ key: string; instruction: string }> = [
  { key: 'history', instruction: 'history, founding, or notable past events' },
  { key: 'geography', instruction: 'geography, landscape, neighborhoods, or layout' },
  { key: 'culture', instruction: 'culture, traditions, customs, or daily life' },
  { key: 'food', instruction: 'food, drink, or culinary traditions' },
  { key: 'people', instruction: 'famous people, residents, or historical figures' },
  { key: 'landmarks', instruction: 'landmarks, buildings, or architecture' },
  { key: 'nature', instruction: 'nature, wildlife, climate, or natural features' },
  { key: 'industry', instruction: 'industry, economy, or what the area is known for' },
];

function buildSingleQuizPrompt(
  nearbyTitles: string[],
  locationLabel: string | undefined,
  previousQuestions: string[],
  questionIndex: number,
  total: number,
  attempt: number = 0
): string {
  const grounding = quizGroundingBlock(nearbyTitles, locationLabel);
  // Pick the angle by (slot + attempt) so each retry of the same slot uses
  // a *different* topic — otherwise the model regenerates the same question
  // from the same prompt and the dedupe loop wastes its budget. Confirmed
  // live on Pixel 3: slot 3 attempt 0 emitted "primary color used by
  // artists" and attempt 1 (with identical prompt) emitted exactly the
  // same string. Bumping the angle on retry breaks that symmetry.
  const angle =
    QUIZ_TOPIC_ANGLES[(questionIndex + attempt) % QUIZ_TOPIC_ANGLES.length];
  // Bake the location into the topic phrase. With just "TOPIC: history",
  // the model would happily write a generic "primary color used by artists"
  // question that has nothing to do with the user's place; saying
  // "history of Palo Alto" forces the location into the same instruction
  // line the model is most likely to follow.
  const locatedTopic = locationLabel
    ? `${angle.instruction} of ${locationLabel}`
    : angle.instruction;
  // Avoid-list is kept as a soft secondary signal so retries (which reuse
  // the same slot index, hence the same angle) still get hint about what
  // not to repeat.
  const lastQuestion = previousQuestions[previousQuestions.length - 1];
  const avoidLine = previousQuestions.length
    ? `\nDo NOT repeat or paraphrase the previous question: "${lastQuestion}". Pick a different fact within the topic above.`
    : '';
  const locationGuard = locationLabel
    ? `Aim the question at ${locationLabel} first. If you don't know a confident fact at that scale, widen to the surrounding metro / region / state / country (in that order) — never a generic worldwide question. `
    : '';
  return buildNarratorPrompt({
    system: `You are writing one local-trivia question (#${questionIndex + 1} of ${total}) for a visitor.`,
    directives: [localePromptDirective()],
    extraContext:
      `${grounding}\n\n` +
      `TOPIC for this question: ${locatedTopic}.\n` +
      `Write exactly ONE multiple-choice question on that topic. 4 options labelled A, B, C, D. ONE correct answer. ` +
      // Length cap — on the 1B model every emitted token is ~50–100 ms
      // of decode on a Pixel 3, so a 25-word question with paragraph-long
      // options pushes a single quiz slot past 30 s. Capping the question
      // and options to phrases keeps each slot under ~10 s.
      `Keep it short: the question must be ONE sentence of at most 14 words; each option must be at most 5 words (a noun phrase, a year, a name). ` +
      `${locationGuard}` +
      `${QUIZ_GROUNDING_RULES}` +
      `${avoidLine}\n\n` +
      // The on-device 1B model consistently truncates after option D and
      // drops any trailing answer marker — even an inline "[correct]" tag
      // on the right option — observed across many runs on Pixel 3. Put
      // the correct-letter line FIRST so it's emitted before the truncation
      // point. The block parser already finds "Correct: <letter>"
      // anywhere in the block.
      `Example of the exact format you must produce (do not reuse this content):\n` +
      `Correct: B\n` +
      `Q: What year was X founded?\n` +
      `A: 1850\n` +
      `B: 1894\n` +
      `C: 1920\n` +
      `D: 1952\n\n` +
      `Now write your one short question on the TOPIC above, in the same six-line format. The first line MUST be "Correct: <letter>" naming which of A/B/C/D is right; the next five lines are Q, A, B, C, D in order. No intro, no explanations, no question number, no closing remarks.`,
  });
}

// Strip a leading option prefix in any of the shapes the model produces:
// "A:", "A.", "A)", "(A)", "[A]", with optional surrounding markdown emphasis.
// Returns the trailing text or null if the line doesn't lead with this letter.
//
// We require at least one *separator* after the letter — either a wrapping
// bracket pair `(A)` / `[A]`, or one of `:.)\-`. Bare `A` followed by text
// without a separator (e.g. "Aardvark") must NOT match, otherwise we'd
// strip the leading 'A' off any answer that happened to start with it.
//
// On-device Gemma also sometimes drops the space after the separator
// ("A:12th Street"), so the trailing whitespace is optional.
function stripOptionPrefix(line: string, letter: string): string | null {
  const re = new RegExp(
    `^(?:` +
      `[\\(\\[]\\s*${letter}\\s*[\\)\\]]\\s*[:.)\\-]?\\s*` +
      `|` +
      `${letter}\\s*[:.)\\-]\\s*` +
    `)`,
    'i'
  );
  const m = line.match(re);
  if (!m) return null;
  return line.slice(m[0].length).trim();
}

function parseQuizBlock(block: string): QuizQuestion | null {
  const cleaned = stripMarkdownEmphasis(block);
  const lines = cleaned
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Tolerate a numbered prefix like "1. Q: ..." or "Question 1: ...".
  const qLine = lines.find((l) => /^(?:\d+[.)]\s*)?(?:Q|Question)\s*\d*\s*[:.)\-]/i.test(l));
  const q = qLine
    ?.replace(/^(?:\d+[.)]\s*)?(?:Q|Question)\s*\d*\s*[:.)\-]\s*/i, '')
    .trim();

  const opts: Record<string, string> = {};
  for (const letter of ['A', 'B', 'C', 'D']) {
    for (const l of lines) {
      const stripped = stripOptionPrefix(l, letter);
      if (stripped) {
        opts[letter] = stripped;
        break;
      }
    }
  }

  // Accept "Correct:" and the common drifts "Answer:" / "Correct answer:".
  const correctLine = lines.find((l) => /^(correct(\s*answer)?|answer)\s*[:.\-]/i.test(l));
  let correctLetter = correctLine
    ?.replace(/^(correct(\s*answer)?|answer)\s*[:.\-]\s*/i, '')
    .trim()
    .charAt(0)
    .toUpperCase();

  // Fallback: model sometimes encodes the correct option by putting `(correct)`
  // or a `*` next to one of the option lines instead of writing a Correct line.
  if (!correctLetter || !['A', 'B', 'C', 'D'].includes(correctLetter)) {
    for (const letter of ['A', 'B', 'C', 'D']) {
      const flagged = lines.find((l) => {
        const stripped = stripOptionPrefix(l, letter);
        return stripped != null && /\b(correct|answer)\b|^\s*\*/i.test(stripped);
      });
      if (flagged) {
        correctLetter = letter;
        break;
      }
    }
  }

  if (!q || !correctLetter) return null;
  if (!['A', 'B', 'C', 'D'].includes(correctLetter)) return null;
  if (!opts.A || !opts.B || !opts.C || !opts.D) {
    // Final attempt: split the original block on inline option boundaries
    // (e.g. "Q: ... A: ... B: ... C: ... D: ...") in case the model put
    // everything on one or two lines instead of the requested six.
    const inline = cleaned.replace(/\s+/g, ' ');
    for (const letter of ['A', 'B', 'C', 'D']) {
      if (opts[letter]) continue;
      const re = new RegExp(
        `(?:^|[\\s\\(\\[])${letter}\\s*[\\)\\]]?\\s*[:.\\-]\\s*(.+?)(?=\\s+(?:[A-D]\\s*[\\)\\]]?\\s*[:.\\-]|Correct|Answer)|$)`,
        'i'
      );
      const m = inline.match(re);
      if (m) opts[letter] = m[1].trim().replace(/[\s.;,]+$/, '');
    }
    if (!opts.A || !opts.B || !opts.C || !opts.D) return null;
  }
  // Strip the inline correctness marker — "(correct)", "[correct]", a
  // trailing "*", "(answer)" — from each option's display text. Without
  // this, the right answer would render as "Jupiter (correct)" in the
  // quiz UI, giving the answer away.
  const stripCorrectnessMarker = (s: string): string =>
    s
      .replace(/\s*[\[(]\s*(?:correct|answer)\s*[\])]\s*$/i, '')
      .replace(/\s*\*+\s*$/, '')
      .trim();
  return {
    question: q,
    options: [
      stripCorrectnessMarker(opts.A),
      stripCorrectnessMarker(opts.B),
      stripCorrectnessMarker(opts.C),
      stripCorrectnessMarker(opts.D),
    ],
    correctIndex: { A: 0, B: 1, C: 2, D: 3 }[correctLetter as 'A' | 'B' | 'C' | 'D'],
  };
}

function splitQuizBlocks(text: string): string[] {
  return text.split(/\r?\n\s*\r?\n/);
}

function parseQuiz(text: string): QuizQuestion[] {
  const out: QuizQuestion[] = [];
  for (const block of splitQuizBlocks(text)) {
    const q = parseQuizBlock(block);
    if (q) out.push(q);
    if (out.length >= 10) break;
  }
  return out;
}

// Normalise a question for duplicate detection: lowercase, strip punctuation,
// keep the first 8 words. Compares topic, not exact wording — "What year was
// the Eiffel Tower built?" and "When was the Eiffel Tower built?" should
// collide.
function questionFingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join(' ');
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
    // Wrap parsePlaceList so empty results dump the raw model text — without
    // this, an "Around you" call that returns 0 names looks identical in
    // logcat whether Gemma produced nothing, was filtered to nothing, or hit
    // the token cap mid-emit. The dump is __DEV__-only and truncated to
    // keep logcat readable.
    const parse = (raw: string): string[] => {
      const parsed = parsePlaceList(raw);
      if (__DEV__) {
        if (parsed.length === 0) {
          // eslint-disable-next-line no-console
          console.warn(
            '[NearbyPlaces] parsePlaceList returned 0 names; raw output:\n' +
              raw.slice(0, 600)
          );
        } else {
          // eslint-disable-next-line no-console
          console.log('[NearbyPlaces] parsePlaceList returned', parsed.length, 'names:', parsed.join(', '));
        }
      }
      return parsed;
    };
    return runParsedStream(prompt, parse, { maxTokens: 180 });
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
   *
   * Single inference call asking for all `count` questions in one prompt.
   * Used by tests and any caller that doesn't need incremental UI.
   * `locationLabel` (e.g. "Palo Alto, California") is injected into the
   * prompt so the model grounds questions in the user's actual region —
   * without it, Gemma drifts to whatever famous city it knows.
   */
  generateQuiz(
    nearbyTitles: string[],
    count: number = 5,
    locationLabel?: string
  ): QuizTask {
    const prompt = buildQuizPrompt(nearbyTitles, count, locationLabel);
    return runParsedStream(prompt, parseQuiz, { maxTokens: 700 });
  },

  /**
   * Streaming variant: makes one inference call per question and emits each
   * via `handlers.onQuestion` as soon as it's parsed. The previous question
   * texts are threaded into each subsequent prompt as a do-not-repeat list,
   * and any duplicate that slips through is rejected and re-generated on
   * the JS side (capped at MAX_DEDUPE_RETRIES per slot to avoid loops).
   *
   * Why per-question rather than one batch prompt: on the small on-device
   * model, a single prompt asking for 5 questions tends to (a) pad to a
   * famous landmark when the POI list is thin and (b) repeat the first
   * question several times. Per-question calls let us pass an explicit
   * "already asked" list and cheaply retry duplicates.
   */
  generateQuizStream(
    nearbyTitles: string[],
    count: number,
    handlers: QuizStreamHandlers,
    locationLabel?: string
  ): QuizStreamHandle {
    // Retries for the *same* slot. We use the same budget to cover both
    // duplicate-of-prior and unparseable-output failures, since both are
    // recoverable — a fresh inference call on the same prompt usually lands
    // a different answer.
    const MAX_DEDUPE_RETRIES = 2;
    // Lowered from 320: paired with the in-prompt length cap (≤14 word
    // question, ≤5 word options) the model now produces a complete
    // 6-line block well under 200 tokens, and capping decode time keeps
    // each slot under ~10 s on Pixel 3 instead of 25–40 s.
    const TOKENS_PER_QUESTION = 200;

    const emitted: QuizQuestion[] = [];
    const fingerprints = new Set<string>();
    let aborted = false;
    let activeHandle: StreamHandle | null = null;
    let activeAbortPromise: Promise<void> | null = null;

    const runOne = async (
      questionIndex: number,
      attempt: number
    ): Promise<QuizQuestion | null> => {
      if (aborted) return null;
      // Yield to any foreground work (nearby places, guide facts) before
      // queueing the next quiz slot. The native LiteRT executor is
      // single-threaded, so without this a quiz call sitting in the queue
      // would block a freshly-issued nearby request behind it for tens of
      // seconds.
      await inferenceService.waitForIdleSlot();
      if (aborted) return null;
      return new Promise((resolve, reject) => {
        const previousTexts = emitted.map((e) => e.question);
        const prompt = buildSingleQuizPrompt(
          nearbyTitles,
          locationLabel,
          previousTexts,
          questionIndex,
          count,
          attempt
        );
        if (__DEV__) {
          // Dump prompt tail so we can verify on device that the topic
          // angle and avoid-line are actually present in the bytes the
          // model received. The first ~500 chars are the static system
          // header — skip them to keep logcat readable.
          const tail = prompt.length > 500 ? prompt.slice(-700) : prompt;
          // eslint-disable-next-line no-console
          console.log(
            `[Quiz] slot ${questionIndex} attempt ${attempt} prompt-tail (last ${tail.length} of ${prompt.length}):\n${tail}`
          );
        }
        let fullText = '';
        let settled = false;
        inferenceService
          .runInferenceStream(
            prompt,
            {
              onToken: (delta) => {
                if (settled) return;
                fullText += delta;
              },
              onDone: () => {
                if (settled) return;
                settled = true;
                activeHandle = null;
                // The model usually emits exactly one block; defensively
                // pick the first parseable one in case it added padding.
                let parsed: QuizQuestion | null = null;
                for (const block of splitQuizBlocks(fullText)) {
                  parsed = parseQuizBlock(block);
                  if (parsed) break;
                }
                // Last-ditch: try parsing the full untrimmed text as one
                // block. The split-on-blank-line heuristic can fragment a
                // legitimate question whose options were separated by
                // accidental blank lines.
                if (!parsed) parsed = parseQuizBlock(fullText);
                if (!parsed && __DEV__) {
                  // Log the raw output so we can diagnose what shape the
                  // on-device model actually produces. Truncated to keep
                  // logcat readable.
                  // eslint-disable-next-line no-console
                  console.warn(
                    '[Quiz] parse failed for slot ' + questionIndex + ':\n' +
                      fullText.slice(0, 600)
                  );
                }
                resolve(parsed);
              },
              onError: (msg) => {
                if (settled) return;
                settled = true;
                activeHandle = null;
                reject(new Error(msg));
              },
            },
            { maxTokens: TOKENS_PER_QUESTION, priority: 'low' }
          )
          .then((handle) => {
            if (aborted || settled) {
              handle.abort();
              return;
            }
            activeHandle = handle;
          })
          .catch((err) => {
            if (settled) return;
            settled = true;
            reject(err instanceof Error ? err : new Error(String(err)));
          });
        // attempt is only used for logging hooks in the future; kept on
        // the closure so callers see the retry count if we ever expose it.
        void attempt;
      });
    };

    (async () => {
      try {
        for (let i = 0; i < count; i++) {
          if (aborted) break;
          // eslint-disable-next-line no-console
          console.log(`[Quiz] slot ${i}: starting (${emitted.length} emitted so far)`);
          let accepted: QuizQuestion | null = null;
          for (let attempt = 0; attempt <= MAX_DEDUPE_RETRIES; attempt++) {
            if (aborted) break;
            // eslint-disable-next-line no-console
            console.log(`[Quiz] slot ${i} attempt ${attempt}: calling runOne`);
            const candidate = await runOne(i, attempt);
            // eslint-disable-next-line no-console
            console.log(`[Quiz] slot ${i} attempt ${attempt}: runOne returned ${candidate ? `q="${candidate.question.slice(0, 40)}"` : 'null'}`);
            // Parse failure: small on-device models drop format roughly 1 in
            // 5 tries. Keep retrying within this slot's budget rather than
            // aborting the whole run.
            if (!candidate) continue;
            const fp = questionFingerprint(candidate.question);
            if (!fingerprints.has(fp)) {
              accepted = candidate;
              fingerprints.add(fp);
              break;
            }
            // eslint-disable-next-line no-console
            console.log(`[Quiz] slot ${i} attempt ${attempt}: duplicate detected, fingerprint="${fp}"`);
            // Duplicate: loop and retry. The next prompt will include the
            // already-emitted question texts as the avoid list.
          }
          if (aborted) break;
          if (!accepted) {
            // Three consecutive failures (parse or dupe) for this slot.
            // Skip it but keep trying the rest — partial results are still
            // useful.
            // eslint-disable-next-line no-console
            console.warn(`[Quiz] slot ${i}: all attempts exhausted, skipping slot`);
            continue;
          }
          emitted.push(accepted);
          // eslint-disable-next-line no-console
          console.log(`[Quiz] slot ${i}: accepted, emitting q="${accepted.question.slice(0, 40)}"`);
          handlers.onQuestion(accepted, emitted.length - 1);
          // Explicit handoff log: confirms the preload pipeline. The next
          // slot's runOne will be entered on the very next iteration of this
          // for-loop, BEFORE the user has had a chance to interact with
          // the question we just emitted. If you're trying to verify
          // preload behavior in logcat, look for this line followed
          // shortly by "[Quiz] slot N+1 attempt 0: calling runOne".
          if (i + 1 < count) {
            // eslint-disable-next-line no-console
            console.log(`[Quiz] PRELOAD slot ${i + 1} starting NOW while user reviews Q${i + 1}`);
          }
        }
        // eslint-disable-next-line no-console
        console.log(`[Quiz] driver loop done: emitted=${emitted.length}`);
        if (!aborted) handlers.onDone(emitted);
      } catch (err) {
        if (aborted) return;
        handlers.onError(err instanceof Error ? err.message : String(err));
      }
    })();

    return {
      abort: async () => {
        if (aborted) return activeAbortPromise ?? Promise.resolve();
        aborted = true;
        if (activeHandle) {
          activeAbortPromise = activeHandle.abort();
          await activeAbortPromise;
        }
      },
    };
  },

  /**
   * Kick off a low-priority quiz generation in the background so the modal
   * has questions waiting (or partially waiting) when the user opens it.
   * Idempotent for the same (location, POI mix); a different key aborts the
   * prior prefetch. Does NOT compete with foreground inference: each slot
   * awaits inferenceService.waitForIdleSlot() before issuing its native call.
   */
  prefetchQuiz(
    nearbyTitles: string[],
    count: number,
    locationLabel?: string
  ): void {
    const key = quizPrefetchKey(nearbyTitles, locationLabel);
    if (activePrefetch && activePrefetch.key === key && !activePrefetch.errorMsg) {
      // Already prefetching (or finished) for this key — nothing to do.
      return;
    }
    if (activePrefetch?.stream) {
      activePrefetch.stream.abort().catch(() => {});
    }
    const entry: QuizPrefetchEntry = {
      key,
      questions: [],
      stream: null,
      observers: [],
      done: false,
      doneAll: [],
      errorMsg: null,
    };
    activePrefetch = entry;
    // eslint-disable-next-line no-console
    console.log(`[QuizPrefetch] starting for key="${key}" count=${count}`);
    entry.stream = this.generateQuizStream(
      nearbyTitles,
      count,
      {
        onQuestion: (q, i) => {
          entry.questions.push(q);
          for (const obs of entry.observers) obs.onQuestion(q, i);
        },
        onDone: (all) => {
          entry.done = true;
          entry.doneAll = all;
          entry.stream = null;
          // eslint-disable-next-line no-console
          console.log(`[QuizPrefetch] done — buffered ${all.length} questions for key="${key}"`);
          for (const obs of entry.observers) obs.onDone(all);
        },
        onError: (msg) => {
          entry.errorMsg = msg;
          entry.stream = null;
          // eslint-disable-next-line no-console
          console.warn(`[QuizPrefetch] error for key="${key}": ${msg}`);
          for (const obs of entry.observers) obs.onError(msg);
        },
      },
      locationLabel
    );
  },

  /**
   * Modal-side hook: try to attach to an in-flight (or finished) prefetch
   * for the given key. Returns the buffered questions plus a handle that
   * forwards future onQuestion / onDone / onError events to the supplied
   * callbacks, or null if no matching prefetch exists. Aborting the handle
   * tears down the underlying prefetch stream too — the modal owns the
   * lifecycle once it has attached.
   */
  attachPrefetchedQuiz(
    nearbyTitles: string[],
    locationLabel: string | undefined,
    callbacks: PrefetchObserver
  ): { initial: QuizQuestion[]; handle: QuizStreamHandle } | null {
    const key = quizPrefetchKey(nearbyTitles, locationLabel);
    if (!activePrefetch || activePrefetch.key !== key) return null;
    const entry = activePrefetch;
    entry.observers.push(callbacks);
    // eslint-disable-next-line no-console
    console.log(
      `[QuizPrefetch] attach for key="${key}" — buffer=${entry.questions.length} done=${entry.done}`
    );
    // If the prefetch already finished or errored before the modal opened,
    // fire the matching event on the next tick so the modal can react in
    // its own effect cycle rather than synchronously inside attach.
    if (entry.done) {
      setTimeout(() => callbacks.onDone(entry.doneAll), 0);
    } else if (entry.errorMsg) {
      const msg = entry.errorMsg;
      setTimeout(() => callbacks.onError(msg), 0);
    }
    return {
      initial: entry.questions.slice(),
      handle: {
        abort: async () => {
          // Detach this observer; if it was the only one, clear the active
          // prefetch slot so the next prefetchQuiz call can start fresh.
          entry.observers = entry.observers.filter((o) => o !== callbacks);
          if (entry.observers.length === 0) {
            if (entry.stream) {
              await entry.stream.abort().catch(() => {});
            }
            if (activePrefetch === entry) activePrefetch = null;
          }
        },
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
