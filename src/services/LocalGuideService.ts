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
- You have GPS coordinates, not a place name. If you don't clearly recognize the area, speak in general terms — never guess the city.
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

function formatLocation(location: GPSContext | string): string {
  if (typeof location === 'string') return location;
  const accuracyNote = location.accuracy != null ? ` (±${Math.round(location.accuracy)}m)` : '';
  return `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}${accuracyNote}`;
}

function buildPrompt(location: GPSContext | string, userQuery: string, topic?: GuideTopic): string {
  const coords = formatLocation(location);
  const query = userQuery.trim() || 'Narrate what is interesting about this spot.';
  return `${SYSTEM_PROMPT}${topicFocusLine(topic)}\nGPS: ${coords}\nCue: ${query}`;
}

export interface GuideResponse {
  text: string;
  locationUsed: GPSContext | string;
  durationMs: number;
}

function buildImagePrompt(location: GPSContext | string, userQuery: string, topic?: GuideTopic): string {
  const coords = formatLocation(location);
  const query = userQuery.trim() || 'Narrate what is in this photo.';
  return (
    `${SYSTEM_PROMPT}${topicFocusLine(topic)}\n` +
    `GPS: ${coords}\n` +
    `The visitor shared a photo from this spot. Identify what's in it and narrate its story — what it is, why it matters, the history and cultural background a local would share. Ground every claim in what's actually visible; use GPS only to disambiguate. If image and GPS disagree, trust the image.\n` +
    `Cue: ${query}`
  );
}

export const localGuideService = {
  async initialize(): Promise<void> {
    return inferenceService.initialize();
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
