/**
 * Characterization: Chat flow
 *
 * Locks in current behavior of LocalGuideService prompt construction, response
 * shaping, and the InferenceService call contract.  These tests describe what
 * the code does TODAY — including quirks — so that refactor PRs can verify
 * nothing regressed.  If a PR intentionally changes behavior, update the
 * relevant assertion and leave a commit note explaining why.
 */

import { localGuideService } from '../services/LocalGuideService';
import type { GPSContext } from '../services/InferenceService';

// ── Mock the native module so InferenceService runs in mock mode ───────────
jest.mock('../native/LiteRTModule', () => ({ __esModule: true, default: undefined }));
// ── ModelDownloadService path constant (imported by InferenceService) ──────
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///data/user/0/com.localguideapp/files/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: false }),
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
}));

const GPS_PARIS: GPSContext = { latitude: 48.8566, longitude: 2.3522, accuracy: 10 };
const GPS_NO_ACCURACY: GPSContext = { latitude: 51.5074, longitude: -0.1278, accuracy: undefined };

// ── Intercept runInference so we can inspect the prompt ────────────────────
// Variable must be prefixed "mock" to be accessible inside jest.mock() factory
const mockRunInferenceSpy = jest.fn().mockResolvedValue('Some tourist info.');

jest.mock('../services/InferenceService', () => {
  const actual = jest.requireActual('../services/InferenceService');
  return {
    ...actual,
    inferenceService: {
      initialize: jest.fn().mockResolvedValue(undefined),
      runInference: (...args: unknown[]) => mockRunInferenceSpy(...args),
      dispose: jest.fn().mockResolvedValue(undefined),
      isLoaded: true,
    },
  };
});

describe('Characterization: LocalGuideService — prompt format', () => {
  let service: typeof localGuideService;

  beforeEach(() => {
    // LocalGuideService is a plain object export; use the module directly
    service = require('../services/LocalGuideService').localGuideService;
    mockRunInferenceSpy.mockClear();
    mockRunInferenceSpy.mockResolvedValue('Some tourist info.');
  });

  it('builds prompt with system header, coordinates, and user query', async () => {
    await service.ask('What is near me?', GPS_PARIS);

    expect(mockRunInferenceSpy).toHaveBeenCalledTimes(1);
    const prompt: string = mockRunInferenceSpy.mock.calls[0][0];

    // System prompt present
    expect(prompt).toContain('local tourist guide');
    // Location section present
    expect(prompt).toContain('Current location:');
    // Coordinates formatted to 6 decimal places
    expect(prompt).toContain('48.856600');
    expect(prompt).toContain('2.352200');
    // Accuracy appended when present
    expect(prompt).toContain('±10m');
    // User query present
    expect(prompt).toContain('What is near me?');
    // Ends with "Guide:" suffix
    expect(prompt.endsWith('Guide:')).toBe(true);
  });

  it('omits accuracy note when accuracy is undefined', async () => {
    await service.ask('What is near me?', GPS_NO_ACCURACY);

    const prompt: string = mockRunInferenceSpy.mock.calls[0][0];
    expect(prompt).not.toContain('±');
    expect(prompt).toContain('51.507400');
  });

  it('uses default maxTokens of 512 when no options passed', async () => {
    await service.ask('test query', GPS_PARIS);
    const options = mockRunInferenceSpy.mock.calls[0][1];
    // No options object passed by LocalGuideService — InferenceService uses its default
    expect(options).toBeUndefined();
  });
});

describe('Characterization: LocalGuideService — response shaping', () => {
  let service: typeof localGuideService;

  beforeEach(() => {
    service = require('../services/LocalGuideService').localGuideService;
    mockRunInferenceSpy.mockClear();
  });

  it('trims leading/trailing whitespace from inference output', async () => {
    mockRunInferenceSpy.mockResolvedValue('  Trimmed response.  \n');
    const result = await service.ask('test', GPS_PARIS);
    expect(result.text).toBe('Trimmed response.');
  });

  it('returns locationUsed equal to the gps argument', async () => {
    mockRunInferenceSpy.mockResolvedValue('ok');
    const result = await service.ask('test', GPS_PARIS);
    expect(result.locationUsed).toBe(GPS_PARIS);
  });

  it('returns durationMs as a non-negative number', async () => {
    mockRunInferenceSpy.mockResolvedValue('ok');
    const result = await service.ask('test', GPS_PARIS);
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('propagates inference errors to the caller', async () => {
    mockRunInferenceSpy.mockRejectedValue(new Error('inference failure'));
    await expect(service.ask('test', GPS_PARIS)).rejects.toThrow('inference failure');
  });
});
