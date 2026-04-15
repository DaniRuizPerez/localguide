/**
 * Tests for LocalGuideService prompt construction and response formatting.
 * Validates that GPS context is correctly embedded in prompts and responses
 * are properly trimmed/structured.
 */

jest.mock('../native/LiteRTModule', () => ({
  __esModule: true,
  default: undefined,
}));

// Intercept the inference call so we can inspect the full prompt
const mockRunInference = jest.fn();

jest.mock('../services/InferenceService', () => {
  const actual = jest.requireActual('../services/InferenceService');

  // Wrap InferenceService so runInference delegates to our spy
  class PatchedInferenceService extends actual.InferenceService {
    async runInference(prompt: string, options = {}) {
      mockRunInference(prompt, options);
      return `You are near the Eiffel Tower.   `; // intentional trailing whitespace
    }
  }

  return {
    ...actual,
    InferenceService: PatchedInferenceService,
    inferenceService: new PatchedInferenceService(),
  };
});

import { localGuideService } from '../services/LocalGuideService';

describe('LocalGuideService — prompt format', () => {
  const paris = { latitude: 48.856600, longitude: 2.352200, accuracy: 15 };

  afterAll(async () => {
    await localGuideService.dispose();
  });

  it('includes latitude and longitude in the prompt', async () => {
    await localGuideService.ask('What is near me?', paris);
    const [prompt] = mockRunInference.mock.calls[0];
    expect(prompt).toContain('48.856600');
    expect(prompt).toContain('2.352200');
  });

  it('includes accuracy note when provided', async () => {
    await localGuideService.ask('Any restaurants?', paris);
    const [prompt] = mockRunInference.mock.calls[mockRunInference.mock.calls.length - 1];
    expect(prompt).toMatch(/±15m/);
  });

  it('omits accuracy note when not provided', async () => {
    const noAccuracy = { latitude: 51.5074, longitude: -0.1278 };
    await localGuideService.ask('Tell me about here', noAccuracy);
    const [prompt] = mockRunInference.mock.calls[mockRunInference.mock.calls.length - 1];
    expect(prompt).not.toMatch(/±/);
  });

  it('includes user query in prompt', async () => {
    const query = 'What is the best pizza nearby?';
    await localGuideService.ask(query, paris);
    const [prompt] = mockRunInference.mock.calls[mockRunInference.mock.calls.length - 1];
    expect(prompt).toContain(query);
  });

  it('includes tourist guide system prompt', async () => {
    await localGuideService.ask('test', paris);
    const [prompt] = mockRunInference.mock.calls[mockRunInference.mock.calls.length - 1];
    expect(prompt).toContain('tourist guide');
    expect(prompt).toContain('offline');
  });

  it('trims whitespace from response', async () => {
    const result = await localGuideService.ask('test', paris);
    expect(result.text).toBe(result.text.trim());
  });

  it('includes locationUsed matching input GPS', async () => {
    const result = await localGuideService.ask('test', paris);
    expect(result.locationUsed).toEqual(paris);
  });

  it('records non-negative durationMs', async () => {
    const result = await localGuideService.ask('test', paris);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('LocalGuideService — coordinate precision', () => {
  afterAll(async () => {
    await localGuideService.dispose();
  });

  it('formats coordinates to 6 decimal places', async () => {
    const gps = { latitude: 40.712776, longitude: -74.005974 };
    await localGuideService.ask('test', gps);
    const [prompt] = mockRunInference.mock.calls[mockRunInference.mock.calls.length - 1];
    // toFixed(6) preserves 6 decimal places
    expect(prompt).toContain('40.712776');
    expect(prompt).toContain('-74.005974');
  });

  it('rounds accuracy to nearest meter', async () => {
    const gps = { latitude: 48.8566, longitude: 2.3522, accuracy: 7.8 };
    await localGuideService.ask('test', gps);
    const [prompt] = mockRunInference.mock.calls[mockRunInference.mock.calls.length - 1];
    // Math.round(7.8) = 8
    expect(prompt).toContain('±8m');
  });
});
