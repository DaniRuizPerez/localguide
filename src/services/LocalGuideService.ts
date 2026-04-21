import {
  inferenceService,
  type GPSContext,
  type InferenceOptions,
  type StreamCallbacks,
  type StreamHandle,
} from './InferenceService';
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

function topicFocusLine(topic: GuideTopic | undefined): string {
  if (!topic || topic === 'everything') return '';
  return `\nFocus area: ${TOPIC_LABELS[topic]}. Lean your reply toward this topic unless the user asks about something else.`;
}

// Non-empty when the user's phone locale is not English. Prepended to every
// narration prompt so Gemma speaks the visitor's language.
function localeLine(): string {
  const directive = localePromptDirective();
  return directive ? `\n${directive}` : '';
}

// User-tuned narration length. Appended so it wins over the default
// "3-6 sentences" rule in SYSTEM_PROMPT when they conflict.
function lengthLine(length?: NarrationLength): string {
  const effective = length ?? narrationPrefs.get().length;
  return `\n${narrationLengthDirective(effective)}`;
}

function formatCoordinates(location: GPSContext | string): string {
  if (typeof location === 'string') return location;
  const accuracyNote = location.accuracy != null ? ` (±${Math.round(location.accuracy)}m)` : '';
  return `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}${accuracyNote}`;
}

function placeLine(location: GPSContext | string): string {
  if (typeof location === 'string') return `Place: ${location}\n`;
  return location.placeName ? `Place: ${location.placeName}\n` : '';
}

function buildPrompt(
  location: GPSContext | string,
  userQuery: string,
  topic?: GuideTopic,
  length?: NarrationLength
): string {
  // When we have a resolved place name, we OMIT the coordinates line entirely
  // — Gemma 3 1B tends to parrot numbers back into the narration even when told
  // not to, and coordinates add nothing beyond the place name. When we don't
  // have a place name, coords are the only location signal we have, so we keep
  // them and rely on the system prompt to suppress verbalization.
  const query = userQuery.trim() || 'Narrate what is interesting about this place.';
  const hasPlaceName = typeof location === 'string' || !!(location.placeName);
  const coordinatesLine = hasPlaceName ? '' : `Coordinates: ${formatCoordinates(location)}\n`;
  return (
    `${SYSTEM_PROMPT}${topicFocusLine(topic)}${localeLine()}${lengthLine(length)}\n` +
    `${placeLine(location)}` +
    `${coordinatesLine}` +
    `Cue: ${query}`
  );
}

// Keep the legacy name as an alias so nothing else that references it breaks;
// the public surface is still "formatLocation" for the LLM-list prompt builder.
function formatLocation(location: GPSContext | string): string {
  if (typeof location === 'string') return location;
  const coords = formatCoordinates(location);
  return location.placeName ? `${location.placeName} (${coords})` : coords;
}

export interface GuideResponse {
  text: string;
  locationUsed: GPSContext | string;
  durationMs: number;
}

function buildImagePrompt(
  location: GPSContext | string,
  userQuery: string,
  topic?: GuideTopic,
  length?: NarrationLength
): string {
  const query = userQuery.trim() || 'Narrate what is in this photo.';
  return (
    `${SYSTEM_PROMPT}${topicFocusLine(topic)}${localeLine()}${lengthLine(length)}\n` +
    `${placeLine(location)}` +
    `Coordinates: ${formatCoordinates(location)}\n` +
    `The visitor shared a photo from this spot. Identify what's in it and narrate its story — what it is, why it matters, the history and cultural background a local would share. Ground every claim in what's actually visible; use Place/Coordinates only to disambiguate. If image and location disagree, trust the image.\n` +
    `Cue: ${query}`
  );
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
  const radiusLabel = radiusMeters >= 1000
    ? `${(radiusMeters / 1000).toFixed(radiusMeters % 1000 === 0 ? 0 : 1)} km`
    : `${radiusMeters} m`;
  const hiddenGemsLine = hiddenGems ? `\n${HIDDEN_GEMS_DIRECTIVE}` : '';
  return (
    `You are a local tourist expert helping a traveler find sights worth visiting.${hiddenGemsLine}\n` +
    `${placeLine(location)}` +
    `Coordinates: ${formatCoordinates(location)}\n` +
    `Task: list 6 TOURIST-WORTHY places WITHIN ${radiusLabel} of the visitor — a specific named attraction a traveler would actually go see.\n` +
    `Allowed categories: landmarks, historic sites, famous buildings, parks, gardens, plazas, museums, art galleries, universities, libraries, theaters, monuments, scenic viewpoints, notable neighborhoods.\n` +
    `NEVER include: chain stores (7-Eleven, Starbucks, McDonald's), gas stations, supermarkets, convenience stores, ZIP codes, highways, streets, administrative areas (countries, states, counties), generic schools, bus or metro stations, corporate headquarters.\n` +
    `Real places only; do not invent. If you don't know what's near this place, output nothing.\n` +
    `Output ONLY the place names, one per line. No numbering. No bullets. No descriptions. No intro or closing text.`
  );
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

export interface ListPlacesTask {
  promise: Promise<string[]>;
  abort: () => Promise<void>;
}

export interface ItineraryStop {
  title: string;
  note: string;
}

export interface ItineraryTask {
  promise: Promise<ItineraryStop[]>;
  abort: () => Promise<void>;
}

export interface TimelineEvent {
  year: string;
  event: string;
}

export interface TimelineTask {
  promise: Promise<TimelineEvent[]>;
  abort: () => Promise<void>;
}

function buildTimelinePrompt(poiTitle: string, location: GPSContext | string | null): string {
  const directive = localePromptDirective();
  const localeLine = directive ? `\n${directive}` : '';
  const placeHint =
    location && typeof location !== 'string' && location.placeName
      ? `\nContext: in ${location.placeName}.`
      : typeof location === 'string'
      ? `\nContext: in ${location}.`
      : '';
  return (
    `You are a history-focused local guide. Produce a concise vertical timeline ` +
    `of notable events for this place, from earliest to most recent.${localeLine}\n` +
    `Place: ${poiTitle}${placeHint}\n\n` +
    `Output 4–8 entries, strictly in this format:\n` +
    `YEAR — event description (one sentence)\n\n` +
    `Rules:\n` +
    `- Use a real year, century, or well-known period as YEAR (e.g. "1793", "1880s", "12th century").\n` +
    `- If you are not confident about a specific year, write the period instead.\n` +
    `- Never invent events. If you have fewer than 4 reliable entries, output only the ones you are confident in.\n` +
    `- No bullets, no numbering, no intro, no closing remarks.`
  );
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
  const directive = localePromptDirective();
  const localeLine = directive ? `\n${directive}` : '';
  // Feed the model real nearby POIs so it doesn't hallucinate, but also let
  // it drop or reorder them based on what actually fits the time budget.
  const optionList = nearbyTitles.length
    ? nearbyTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')
    : '(no list available — choose what makes sense near this place)';
  const count = durationHours <= 1.5 ? 3 : durationHours <= 5 ? 5 : 7;
  return (
    `You are a local tour planner helping a visitor with ${durationHours} hour(s) near ` +
    `${typeof location === 'string' ? location : location.placeName ?? formatCoordinates(location)}.${localeLine}\n\n` +
    `Candidate stops (real places, ordered by proximity):\n${optionList}\n\n` +
    `Pick ${count} stops total in the best visit order for someone walking between them. ` +
    `Account for walking time and ~15 min at each stop. Drop the candidates that don't fit; ` +
    `prefer a coherent route (no backtracking) over ticking every box.\n` +
    `Output strictly in this format, one line per stop:\n` +
    `1. STOP NAME — one-sentence reason to visit\n` +
    `2. STOP NAME — one-sentence reason to visit\n` +
    `(no header, no intro, no summary, no bullets other than the numbered list)`
  );
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
    let handleRef: StreamHandle | null = null;
    let settled = false;

    const promise = new Promise<string[]>((resolve, reject) => {
      let fullText = '';
      inferenceService
        .runInferenceStream(
          prompt,
          {
            onToken: (delta) => {
              fullText += delta;
            },
            onDone: () => {
              settled = true;
              resolve(parsePlaceList(fullText));
            },
            onError: (message) => {
              settled = true;
              reject(new Error(message));
            },
          },
          { maxTokens: 180 }
        )
        .then((handle) => {
          if (settled) {
            // Race: onDone/onError landed before we captured the handle. Nothing
            // to abort — the stream already cleaned itself up.
            handle.abort();
            return;
          }
          handleRef = handle;
        })
        .catch((err) => {
          settled = true;
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    });

    return {
      promise,
      abort: async () => {
        if (handleRef) await handleRef.abort();
        settled = true;
      },
    };
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
    let handleRef: StreamHandle | null = null;
    let settled = false;

    const promise = new Promise<ItineraryStop[]>((resolve, reject) => {
      let fullText = '';
      inferenceService
        .runInferenceStream(
          prompt,
          {
            onToken: (delta) => {
              fullText += delta;
            },
            onDone: () => {
              settled = true;
              resolve(parseItinerary(fullText));
            },
            onError: (message) => {
              settled = true;
              reject(new Error(message));
            },
          },
          { maxTokens: 400 }
        )
        .then((handle) => {
          if (settled) {
            handle.abort();
            return;
          }
          handleRef = handle;
        })
        .catch((err) => {
          settled = true;
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    });

    return {
      promise,
      abort: async () => {
        if (handleRef) await handleRef.abort();
        settled = true;
      },
    };
  },

  /**
   * Streams a historical timeline for a POI. Resolves with parsed
   * year/event pairs. Abortable.
   */
  buildTimeline(poiTitle: string, location: GPSContext | string | null): TimelineTask {
    const prompt = buildTimelinePrompt(poiTitle, location);
    let handleRef: StreamHandle | null = null;
    let settled = false;

    const promise = new Promise<TimelineEvent[]>((resolve, reject) => {
      let fullText = '';
      inferenceService
        .runInferenceStream(
          prompt,
          {
            onToken: (delta) => {
              fullText += delta;
            },
            onDone: () => {
              settled = true;
              resolve(parseTimeline(fullText));
            },
            onError: (message) => {
              settled = true;
              reject(new Error(message));
            },
          },
          { maxTokens: 350 }
        )
        .then((handle) => {
          if (settled) {
            handle.abort();
            return;
          }
          handleRef = handle;
        })
        .catch((err) => {
          settled = true;
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    });

    return {
      promise,
      abort: async () => {
        if (handleRef) await handleRef.abort();
        settled = true;
      },
    };
  },

  async askStream(
    userQuery: string,
    location: GPSContext | string,
    callbacks: StreamCallbacks,
    topic?: GuideTopic
  ): Promise<StreamHandle> {
    const prompt = buildPrompt(location, userQuery, topic);
    return inferenceService.runInferenceStream(prompt, callbacks);
  },

  async askWithImageStream(
    userQuery: string,
    location: GPSContext | string,
    imagePath: string,
    callbacks: StreamCallbacks,
    topic?: GuideTopic
  ): Promise<StreamHandle> {
    const prompt = buildImagePrompt(location, userQuery, topic);
    return inferenceService.runInferenceStream(prompt, callbacks, { imagePath });
  },

  async dispose(): Promise<void> {
    return inferenceService.dispose();
  },
};
