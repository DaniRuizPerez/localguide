/**
 * Tests for LocalGuideService image-mode flows (askWithImage / askWithImageStream).
 * Verifies the photo URI is threaded through InferenceService as options.imagePath
 * and that the image prompt contains the vision-grounding instructions.
 */

jest.mock('../native/LiteRTModule', () => ({
  __esModule: true,
  default: undefined,
}));

const mockRunInference = jest.fn();
const mockRunInferenceStream = jest.fn();

jest.mock('../services/InferenceService', () => {
  const actual = jest.requireActual('../services/InferenceService');

  class PatchedInferenceService extends actual.InferenceService {
    async runInference(prompt: string, options: Record<string, unknown> = {}) {
      mockRunInference(prompt, options);
      return 'A stone facade with ornate carvings.';
    }
    async runInferenceStream(
      prompt: string,
      callbacks: { onToken: (s: string) => void; onDone: () => void; onError: (m: string) => void },
      options: Record<string, unknown> = {}
    ) {
      mockRunInferenceStream(prompt, callbacks, options);
      callbacks.onToken('A stone facade.');
      callbacks.onDone();
      return { abort: async () => {} };
    }
  }

  return {
    ...actual,
    InferenceService: PatchedInferenceService,
    inferenceService: new PatchedInferenceService(),
  };
});

import { localGuideService } from '../services/LocalGuideService';

const paris = { latitude: 48.8566, longitude: 2.3522, accuracy: 12 };

describe('LocalGuideService.askWithImage', () => {
  beforeEach(() => {
    mockRunInference.mockClear();
    mockRunInferenceStream.mockClear();
  });

  afterAll(async () => {
    await localGuideService.dispose();
  });

  it('forwards imagePath through options.imagePath', async () => {
    await localGuideService.askWithImage(
      'What is this building?',
      paris,
      'file:///tmp/photo.jpg'
    );
    expect(mockRunInference).toHaveBeenCalledTimes(1);
    const [, options] = mockRunInference.mock.calls[0];
    expect(options.imagePath).toBe('file:///tmp/photo.jpg');
  });

  it('preserves other options passed alongside imagePath', async () => {
    await localGuideService.askWithImage(
      'Describe this',
      paris,
      'file:///tmp/photo.jpg',
      { maxTokens: 128 }
    );
    const [, options] = mockRunInference.mock.calls[0];
    expect(options.maxTokens).toBe(128);
    expect(options.imagePath).toBe('file:///tmp/photo.jpg');
  });

  it('builds an image prompt that tells the model to look at the photo', async () => {
    await localGuideService.askWithImage(
      'What is this?',
      paris,
      'file:///tmp/photo.jpg'
    );
    const [prompt] = mockRunInference.mock.calls[0];
    // Vision grounding rule — every claim must be based on what's visible.
    expect(prompt).toMatch(/actually visible/i);
    // GPS is framed as supporting context, not primary
    expect(prompt).toMatch(/disambiguate/i);
    // Conflict resolution rule — trust the image
    expect(prompt).toMatch(/trust the image/i);
    // System prompt still applied
    expect(prompt).toContain('local tourist guide');
    // User query appears as a Cue line — no placeName means no Place line.
    expect(prompt).toContain('Cue: What is this?');
    // GPS coordinates appear as supporting context via the Coordinates line.
    expect(prompt).toContain('Coordinates:');
    expect(prompt).toContain('48.856600');
    expect(prompt).toContain('2.352200');
  });

  it('falls back to a default query when userQuery is blank', async () => {
    await localGuideService.askWithImage('   ', paris, 'file:///tmp/photo.jpg');
    const [prompt] = mockRunInference.mock.calls[0];
    expect(prompt).toMatch(/what is in this photo/i);
  });

  it('returns the trimmed inference response with locationUsed', async () => {
    const result = await localGuideService.askWithImage(
      'What is this?',
      paris,
      'file:///tmp/photo.jpg'
    );
    expect(result.text).toBe('A stone facade with ornate carvings.');
    expect(result.locationUsed).toEqual(paris);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('LocalGuideService.askWithImageStream', () => {
  beforeEach(() => {
    mockRunInference.mockClear();
    mockRunInferenceStream.mockClear();
  });

  afterAll(async () => {
    await localGuideService.dispose();
  });

  it('forwards imagePath through stream options', async () => {
    const onToken = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();
    await localGuideService.askWithImageStream(
      'Describe this view',
      paris,
      'content://media/external/42',
      { onToken, onDone, onError }
    );
    expect(mockRunInferenceStream).toHaveBeenCalledTimes(1);
    const [prompt, callbacks, options] = mockRunInferenceStream.mock.calls[0];
    expect(options.imagePath).toBe('content://media/external/42');
    expect(callbacks.onToken).toBe(onToken);
    expect(callbacks.onDone).toBe(onDone);
    expect(callbacks.onError).toBe(onError);
    // The streamed prompt uses the vision-aware template.
    expect(prompt).toMatch(/actually visible/i);
    expect(prompt).toMatch(/trust the image/i);
  });

  it('does not forward imagePath to the text-only stream path', async () => {
    const onToken = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();
    await localGuideService.askStream('What is near me?', paris, { onToken, onDone, onError });
    expect(mockRunInferenceStream).toHaveBeenCalledTimes(1);
    const [, , options] = mockRunInferenceStream.mock.calls[0];
    // askStream does not pass options at all; service should default to no image.
    expect(options?.imagePath ?? null).toBeNull();
  });
});
