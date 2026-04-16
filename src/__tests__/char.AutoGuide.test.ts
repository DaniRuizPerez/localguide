/**
 * Characterization: AutoGuideService
 *
 * Locks in current behavior of the triage loop:
 *   - First GPS fix always triggers inference (lastGps starts null)
 *   - Movement < 50 m suppresses inference
 *   - Movement ≥ 50 m triggers inference
 *   - "NOTHING" response → 'nothing' event; speech not called
 *   - Non-NOTHING response → 'interesting' + 'speaking' events; speech called
 *   - Location permission denied → 'error' event; service stops running
 *
 * Update these tests in PR 1 when haversine-null-initialisation fix changes
 * the "first GPS fix" behavior, with a commit note explaining the intentional
 * change.
 */

import type { AutoGuideEvent } from '../services/AutoGuideService';
import type { GPSContext } from '../services/InferenceService';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockRunInference = jest.fn();
jest.mock('../services/InferenceService', () => ({
  inferenceService: {
    initialize: jest.fn().mockResolvedValue(undefined),
    runInference: (...args: unknown[]) => mockRunInference(...args),
    dispose: jest.fn().mockResolvedValue(undefined),
    isLoaded: true,
  },
  // Re-export GPSContext type (value not needed at runtime)
}));

const mockSpeechSpeak = jest.fn().mockResolvedValue(undefined);
const mockSpeechStop = jest.fn();
jest.mock('../services/SpeechService', () => ({
  speechService: {
    speak: (...args: unknown[]) => mockSpeechSpeak(...args),
    stop: (...args: unknown[]) => mockSpeechStop(...args),
    isSpeaking: false,
  },
}));

const mockRequestForeground = jest.fn().mockResolvedValue({ status: 'granted' });
const mockRequestBackground = jest.fn().mockResolvedValue({ status: 'denied' });
const mockGetCurrentPosition = jest.fn();
const mockStartLocationUpdates = jest.fn().mockResolvedValue(undefined);
const mockStopLocationUpdates = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: (...args: unknown[]) => mockRequestForeground(...args),
  requestBackgroundPermissionsAsync: (...args: unknown[]) => mockRequestBackground(...args),
  getCurrentPositionAsync: (...args: unknown[]) => mockGetCurrentPosition(...args),
  startLocationUpdatesAsync: (...args: unknown[]) => mockStartLocationUpdates(...args),
  stopLocationUpdatesAsync: (...args: unknown[]) => mockStopLocationUpdates(...args),
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn().mockResolvedValue(false),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeLocation(lat: number, lon: number, accuracy = 10) {
  return {
    coords: { latitude: lat, longitude: lon, accuracy },
  };
}

// Move ~100 m north (well above the 50 m threshold)
function moveNorth(gps: GPSContext, meters = 100): GPSContext {
  return {
    latitude: gps.latitude + meters / 111_000,
    longitude: gps.longitude,
    accuracy: gps.accuracy,
  };
}

// Move ~10 m north (below the 50 m threshold)
function moveNorthSmall(gps: GPSContext, meters = 10): GPSContext {
  return {
    latitude: gps.latitude + meters / 111_000,
    longitude: gps.longitude,
    accuracy: gps.accuracy,
  };
}

const BASE: GPSContext = { latitude: 48.8566, longitude: 2.3522, accuracy: 10 };

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Characterization: AutoGuideService — triage loop', () => {
  let AutoGuideService: any;
  let service: any;
  const events: AutoGuideEvent[] = [];

  beforeEach(() => {
    jest.resetModules();
    // Re-require after resetModules to get a fresh singleton
    jest.mock('../services/InferenceService', () => ({
      inferenceService: {
        initialize: jest.fn().mockResolvedValue(undefined),
        runInference: (...args: unknown[]) => mockRunInference(...args),
        dispose: jest.fn().mockResolvedValue(undefined),
        isLoaded: true,
      },
    }));
    jest.mock('../services/SpeechService', () => ({
      speechService: {
        speak: (...args: unknown[]) => mockSpeechSpeak(...args),
        stop: (...args: unknown[]) => mockSpeechStop(...args),
        isSpeaking: false,
      },
    }));

    const mod = require('../services/AutoGuideService');
    service = mod.autoGuideService;

    events.length = 0;
    service.setListener((e: AutoGuideEvent) => events.push(e));

    mockRunInference.mockClear();
    mockSpeechSpeak.mockClear();
    mockSpeechStop.mockClear();
    mockGetCurrentPosition.mockClear();
    mockRequestForeground.mockResolvedValue({ status: 'granted' });
    mockRequestBackground.mockResolvedValue({ status: 'denied' });
    mockRunInference.mockResolvedValue('NOTHING');
    mockGetCurrentPosition.mockResolvedValue(makeLocation(BASE.latitude, BASE.longitude));
  });

  afterEach(async () => {
    await service.stop();
  });

  it('CURRENT BEHAVIOR: first GPS fix always triggers inference (lastGps starts null)', async () => {
    // PR 1 will change this: after the fix, first fix after start() will also
    // trigger inference, but subsequent close fixes will not. The baseline
    // (captured here) is: null-check in evaluateLocation means first call always runs.
    mockRunInference.mockResolvedValue('NOTHING');
    await service.start();

    expect(mockRunInference).toHaveBeenCalledTimes(1);
    const prompt: string = mockRunInference.mock.calls[0][0];
    expect(prompt).toContain(`${BASE.latitude.toFixed(6)}`);
  });

  it('movement below 50 m suppresses subsequent inference call', async () => {
    // First poll fires inference (see test above)
    mockRunInference.mockResolvedValue('NOTHING');
    await service.start();
    mockRunInference.mockClear();

    // Small move — should NOT trigger inference
    const nearGps = moveNorthSmall(BASE, 10);
    mockGetCurrentPosition.mockResolvedValue(makeLocation(nearGps.latitude, nearGps.longitude));
    await (service as any).pollOnce?.();
    if (!(service as any).pollOnce) {
      // pollOnce is private; test via handleBackgroundLocation instead
      await service.handleBackgroundLocation(nearGps);
    }

    expect(mockRunInference).not.toHaveBeenCalled();
  });

  it('movement of 100 m triggers inference', async () => {
    mockRunInference.mockResolvedValue('NOTHING');
    await service.start(); // first poll sets lastGps
    mockRunInference.mockClear();

    const farGps = moveNorth(BASE, 100);
    await service.handleBackgroundLocation(farGps);

    expect(mockRunInference).toHaveBeenCalledTimes(1);
  });

  it('"NOTHING" response emits nothing event, does not call speech', async () => {
    mockRunInference.mockResolvedValue('NOTHING');
    await service.start();

    const nothingEvents = events.filter((e) => e.type === 'nothing');
    expect(nothingEvents.length).toBeGreaterThan(0);
    expect(mockSpeechSpeak).not.toHaveBeenCalled();
  });

  it('"NOTHING" match is case-insensitive (startsWith check)', async () => {
    mockRunInference.mockResolvedValue('nothing interesting here');
    await service.start();

    expect(mockSpeechSpeak).not.toHaveBeenCalled();
  });

  it('interesting response emits "interesting" and "speaking" events and calls speech', async () => {
    mockRunInference.mockResolvedValue('You are near the Eiffel Tower. It was built in 1889.');
    await service.start();

    const interestingEvents = events.filter((e) => e.type === 'interesting');
    expect(interestingEvents.length).toBeGreaterThan(0);
    expect(interestingEvents[0].text).toBe('You are near the Eiffel Tower. It was built in 1889.');

    const speakingEvents = events.filter((e) => e.type === 'speaking');
    expect(speakingEvents.length).toBeGreaterThan(0);

    expect(mockSpeechSpeak).toHaveBeenCalledWith(
      'You are near the Eiffel Tower. It was built in 1889.'
    );
  });

  it('interesting response trims the inference output before emitting', async () => {
    mockRunInference.mockResolvedValue('  Near the Louvre.  \n');
    await service.start();

    const interestingEvents = events.filter((e) => e.type === 'interesting');
    expect(interestingEvents[0]?.text).toBe('Near the Louvre.');
  });

  it('triage prompt includes GPS coordinates formatted to 6 decimal places', async () => {
    mockRunInference.mockResolvedValue('NOTHING');
    await service.start();

    const prompt: string = mockRunInference.mock.calls[0][0];
    expect(prompt).toContain('48.856600');
    expect(prompt).toContain('2.352200');
  });

  it('triage prompt uses 256 maxTokens', async () => {
    mockRunInference.mockResolvedValue('NOTHING');
    await service.start();

    const options = mockRunInference.mock.calls[0][1];
    expect(options?.maxTokens).toBe(256);
  });

  it('location permission denied emits error event and service is not running', async () => {
    mockRequestForeground.mockResolvedValue({ status: 'denied' });
    await service.start();

    const errorEvents = events.filter((e) => e.type === 'error');
    expect(errorEvents.length).toBeGreaterThan(0);
    expect(errorEvents[0].text).toContain('permission');
    expect(service.isRunning).toBe(false);
  });

  it('inference error emits error event without crashing', async () => {
    mockRunInference.mockRejectedValue(new Error('model crash'));
    await service.start();

    const errorEvents = events.filter((e) => e.type === 'error');
    expect(errorEvents.length).toBeGreaterThan(0);
  });

  it('stop() clears the running flag and calls speechService.stop()', async () => {
    mockRunInference.mockResolvedValue('NOTHING');
    await service.start();
    expect(service.isRunning).toBe(true);

    await service.stop();
    expect(service.isRunning).toBe(false);
    expect(mockSpeechStop).toHaveBeenCalled();
  });
});
