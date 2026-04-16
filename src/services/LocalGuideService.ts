import { inferenceService, type GPSContext, type InferenceOptions } from './InferenceService';
import { buildPrompt } from './prompt';

const SYSTEM_PROMPT =
  'You are a knowledgeable local tourist guide helping visitors explore the area. ' +
  'Share concise, useful information about nearby landmarks, history, restaurants, ' +
  'and hidden gems. You work fully offline — never mention needing internet access.';

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
    const prompt = buildPrompt(SYSTEM_PROMPT, gps, { includeAccuracy: true, userQuery });
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
