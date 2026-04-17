import { inferenceService, type GPSContext, type InferenceOptions } from './InferenceService';

const SYSTEM_PROMPT =
  'You are a knowledgeable local tourist guide helping visitors explore the area. ' +
  'Share concise, useful information about nearby landmarks, history, restaurants, ' +
  'and hidden gems. You work fully offline — never mention needing internet access.';

function buildPrompt(location: GPSContext | string, userQuery: string): string {
  if (typeof location === 'string') {
    return `${SYSTEM_PROMPT}\n\nCurrent location: ${location}\nUser: ${userQuery}\nGuide:`;
  }
  const accuracyNote = location.accuracy != null ? ` (±${Math.round(location.accuracy)}m)` : '';
  const coords = `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}${accuracyNote}`;
  return `${SYSTEM_PROMPT}\n\nCurrent location: ${coords}\nUser: ${userQuery}\nGuide:`;
}

export interface GuideResponse {
  text: string;
  locationUsed: GPSContext | string;
  durationMs: number;
}

function buildImagePrompt(location: GPSContext | string, userQuery: string): string {
  let coords: string;
  if (typeof location === 'string') {
    coords = location;
  } else {
    const accuracyNote = location.accuracy != null ? ` (±${Math.round(location.accuracy)}m)` : '';
    coords = `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}${accuracyNote}`;
  }
  const question = userQuery.trim()
    ? userQuery
    : 'What am I looking at? What is interesting or notable here?';
  // NOTE: LiteRT-LM (Gemma 3 1B via .task format) is text-only — the runInference API
  // accepts only string prompts. True on-device vision requires a multimodal model such
  // as PaliGemma via the LiteRT image pipeline, which is a separate stack from LM inference.
  // Fallback: use GPS context to generate a location-aware description of what the user
  // might be seeing, displayed alongside their captured photo in the chat.
  return (
    `${SYSTEM_PROMPT}\n\n` +
    `Current location: ${coords}\n` +
    `The user has taken a photo and wants to know about what they're seeing. ` +
    `Using only the GPS location as context, describe what is likely visible or interesting at this spot.\n` +
    `User: ${question}\nGuide:`
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

  // Location-aware response when the user captures a photo.
  // The on-device model is text-only; GPS context is used as a proxy for visual context.
  async askWithImage(
    userQuery: string,
    location: GPSContext | string,
    options?: InferenceOptions
  ): Promise<GuideResponse> {
    const prompt = buildImagePrompt(location, userQuery);
    const start = Date.now();
    const text = await inferenceService.runInference(prompt, options);
    return {
      text: text.trim(),
      locationUsed: location,
      durationMs: Date.now() - start,
    };
  },

  async dispose(): Promise<void> {
    return inferenceService.dispose();
  },
};
