/**
 * A7 — verifies listNearbyPlaces injects the hidden-gems directive into the
 * LLM-fallback prompt when guidePrefs.hiddenGems is enabled.
 */

const mockRunStream = jest.fn();

jest.mock('../services/InferenceService', () => {
  const actual = jest.requireActual('../services/InferenceService');

  class PatchedInferenceService extends actual.InferenceService {
    async runInferenceStream(prompt: string, callbacks: any, options?: any) {
      mockRunStream(prompt, options);
      // Immediately resolve with no tokens to cleanly end the task.
      queueMicrotask(() => callbacks.onDone());
      return { abort: jest.fn().mockResolvedValue(undefined) };
    }
  }

  return {
    ...actual,
    InferenceService: PatchedInferenceService,
    inferenceService: new PatchedInferenceService(),
  };
});

import { localGuideService } from '../services/LocalGuideService';
import { guidePrefs, HIDDEN_GEMS_DIRECTIVE } from '../services/GuidePrefs';

describe('listNearbyPlaces — hidden gems directive', () => {
  const paris = { latitude: 48.8566, longitude: 2.3522 };

  beforeEach(() => {
    mockRunStream.mockReset();
    guidePrefs.__resetForTest();
  });

  afterAll(async () => {
    await localGuideService.dispose();
  });

  it('does NOT include the hidden-gems directive when the toggle is off', async () => {
    await localGuideService.listNearbyPlaces(paris, 1000).promise;
    const [prompt] = mockRunStream.mock.calls[0];
    expect(prompt).not.toContain(HIDDEN_GEMS_DIRECTIVE);
  });

  it('DOES include the hidden-gems directive when the toggle is on', async () => {
    guidePrefs.setHiddenGems(true);
    await localGuideService.listNearbyPlaces(paris, 1000).promise;
    const [prompt] = mockRunStream.mock.calls[0];
    expect(prompt).toContain(HIDDEN_GEMS_DIRECTIVE);
    // Prompt should still ask for landmarks.
    expect(prompt).toContain('landmarks');
  });
});
