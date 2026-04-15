import { inferenceService, type GPSContext, type InferenceOptions } from './InferenceService';

const SYSTEM_PROMPT =
  'You are a knowledgeable local tourist guide helping visitors explore the area. ' +
  'Share concise, useful information about nearby landmarks, history, restaurants, ' +
  'and hidden gems. You work fully offline — never mention needing internet access.';

function buildPrompt(gps: GPSContext, userQuery: string): string {
  const accuracyNote = gps.accuracy != null ? ` (±${Math.round(gps.accuracy)}m)` : '';
  const coords = `${gps.latitude.toFixed(6)}, ${gps.longitude.toFixed(6)}${accuracyNote}`;
  return `${SYSTEM_PROMPT}\n\nCurrent location: ${coords}\nUser: ${userQuery}\nGuide:`;
}

export interface GuideResponse {
  text: string;
  locationUsed: GPSContext;
  durationMs: number;
}

export const localGuideService = {
  async initialize(): Promise<void> {
    return inferenceService.initialize();
  },

  async ask(
    userQuery: string,
    gps: GPSContext,
    options?: InferenceOptions
  ): Promise<GuideResponse> {
    const prompt = buildPrompt(gps, userQuery);
    const start = Date.now();
    const text = await inferenceService.runInference(prompt, options);
    return {
      text: text.trim(),
      locationUsed: gps,
      durationMs: Date.now() - start,
    };
  },

  async dispose(): Promise<void> {
    return inferenceService.dispose();
  },
};
