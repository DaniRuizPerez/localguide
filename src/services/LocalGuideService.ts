import {
  inferenceService,
  type GPSContext,
  type InferenceOptions,
  type StreamCallbacks,
  type StreamHandle,
} from './InferenceService';

// Kept terse on purpose: prefill cost is O(prompt tokens), and on low-end CPU devices
// (Pixel 3-class) every 100 tokens of system prompt adds ~0.5–1 s before the first
// response token appears. This condenses the prior ~400-token prompt to ~90 tokens
// while preserving the load-bearing rules (offline, coords-not-names, no invented
// specifics, conversational tone). If we need richer instructions later, do it via
// response post-processing rather than adding to the system prompt.
const SYSTEM_PROMPT = `You are an offline local tourist guide. Reply in 2–5 warm, conversational sentences in the user's language.
Rules:
- You have GPS coordinates, not a place name. If you don't clearly recognize the area, speak in general terms — never guess the city.
- Never invent specific names, addresses, hours, prices, or distances. If asked, say you can't verify offline and offer general guidance.
- Stay on local topics (landmarks, history, culture, food, walking, etiquette); briefly decline anything else.`;

function formatLocation(location: GPSContext | string): string {
  if (typeof location === 'string') return location;
  const accuracyNote = location.accuracy != null ? ` (±${Math.round(location.accuracy)}m)` : '';
  return `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}${accuracyNote}`;
}

function buildPrompt(location: GPSContext | string, userQuery: string): string {
  const coords = formatLocation(location);
  const query = userQuery.trim() || 'Tell me something interesting about where I am.';
  return `${SYSTEM_PROMPT}\nGPS: ${coords}\nUser: ${query}`;
}

export interface GuideResponse {
  text: string;
  locationUsed: GPSContext | string;
  durationMs: number;
}

function buildImagePrompt(location: GPSContext | string, userQuery: string): string {
  const coords = formatLocation(location);
  const query = userQuery.trim() || 'What am I looking at here?';
  return (
    `${SYSTEM_PROMPT}\n` +
    `GPS: ${coords}\n` +
    `A photo was taken at this spot. Describe what is actually visible in the image and ground every claim in it. Use GPS only to disambiguate. Follow the rules above.\n` +
    `User: ${query}`
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
    callbacks: StreamCallbacks
  ): Promise<StreamHandle> {
    const prompt = buildPrompt(location, userQuery);
    return inferenceService.runInferenceStream(prompt, callbacks);
  },

  async askWithImageStream(
    userQuery: string,
    location: GPSContext | string,
    imagePath: string,
    callbacks: StreamCallbacks
  ): Promise<StreamHandle> {
    const prompt = buildImagePrompt(location, userQuery);
    return inferenceService.runInferenceStream(prompt, callbacks, { imagePath });
  },

  async dispose(): Promise<void> {
    return inferenceService.dispose();
  },
};
