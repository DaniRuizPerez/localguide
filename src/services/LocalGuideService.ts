import {
  inferenceService,
  type GPSContext,
  type InferenceOptions,
  type StreamCallbacks,
  type StreamHandle,
} from './InferenceService';

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

function formatCoordinates(location: GPSContext | string): string {
  if (typeof location === 'string') return location;
  const accuracyNote = location.accuracy != null ? ` (±${Math.round(location.accuracy)}m)` : '';
  return `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}${accuracyNote}`;
}

function placeLine(location: GPSContext | string): string {
  if (typeof location === 'string') return `Place: ${location}\n`;
  return location.placeName ? `Place: ${location.placeName}\n` : '';
}

function buildPrompt(location: GPSContext | string, userQuery: string, topic?: GuideTopic): string {
  // When we have a resolved place name, we OMIT the coordinates line entirely
  // — Gemma 3 1B tends to parrot numbers back into the narration even when told
  // not to, and coordinates add nothing beyond the place name. When we don't
  // have a place name, coords are the only location signal we have, so we keep
  // them and rely on the system prompt to suppress verbalization.
  const query = userQuery.trim() || 'Narrate what is interesting about this place.';
  const hasPlaceName = typeof location === 'string' || !!(location.placeName);
  const coordinatesLine = hasPlaceName ? '' : `Coordinates: ${formatCoordinates(location)}\n`;
  return (
    `${SYSTEM_PROMPT}${topicFocusLine(topic)}\n` +
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

function buildImagePrompt(location: GPSContext | string, userQuery: string, topic?: GuideTopic): string {
  const query = userQuery.trim() || 'Narrate what is in this photo.';
  return (
    `${SYSTEM_PROMPT}${topicFocusLine(topic)}\n` +
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
function buildNearbyPlacesPrompt(location: GPSContext | string, radiusMeters: number): string {
  const radiusLabel = radiusMeters >= 1000
    ? `${(radiusMeters / 1000).toFixed(radiusMeters % 1000 === 0 ? 0 : 1)} km`
    : `${radiusMeters} m`;
  return (
    `You are a local tourist expert helping a traveler find sights worth visiting.\n` +
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
    const prompt = buildNearbyPlacesPrompt(location, radiusMeters);
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
