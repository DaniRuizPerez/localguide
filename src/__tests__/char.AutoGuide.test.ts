/**
 * AutoGuideService — post-refactor behavior.
 *
 * The service no longer runs inference or TTS directly — ChatScreen drives
 * narration via useProximityNarration (Wikipedia POIs + distance checks) plus
 * a one-shot welcome when Auto-Guide toggles on. This service now only:
 *   - gates background-location permission on Auto-Guide being on
 *   - forwards background location fixes to listeners as location_update
 *     events so useAutoGuide keeps latestGps fresh when the app is
 *     backgrounded.
 * Tests pin this narrower contract.
 */

import type { AutoGuideEvent } from '../services/AutoGuideService';
import type { GPSContext } from '../services/InferenceService';

const mockSpeechStop = jest.fn();
jest.mock('../services/SpeechService', () => ({
  speechService: {
    speak: jest.fn().mockResolvedValue(undefined),
    stop: (...args: unknown[]) => mockSpeechStop(...args),
    isSpeaking: false,
  },
}));

const mockRequestBackground = jest.fn().mockResolvedValue({ status: 'denied' });
const mockStartLocationUpdates = jest.fn().mockResolvedValue(undefined);
const mockStopLocationUpdates = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestBackgroundPermissionsAsync: (...args: unknown[]) => mockRequestBackground(...args),
  startLocationUpdatesAsync: (...args: unknown[]) => mockStartLocationUpdates(...args),
  stopLocationUpdatesAsync: (...args: unknown[]) => mockStopLocationUpdates(...args),
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn().mockResolvedValue(true),
}));

const BASE: GPSContext = { latitude: 48.8566, longitude: 2.3522, accuracy: 10 };

describe('AutoGuideService', () => {
  let service: (typeof import('../services/AutoGuideService'))['autoGuideService'];
  const events: AutoGuideEvent[] = [];

  beforeEach(() => {
    jest.resetModules();
    const mod = require('../services/AutoGuideService');
    service = mod.autoGuideService;

    events.length = 0;
    service.setListener((e: AutoGuideEvent) => events.push(e));

    mockSpeechStop.mockClear();
    mockRequestBackground.mockClear();
    mockStartLocationUpdates.mockClear();
    mockStopLocationUpdates.mockClear();
    mockRequestBackground.mockResolvedValue({ status: 'denied' });
  });

  afterEach(async () => {
    await service.stop();
  });

  it('start() flips isRunning on', async () => {
    await service.start();
    expect(service.isRunning).toBe(true);
  });

  it('start() requests background-location permission', async () => {
    await service.start();
    expect(mockRequestBackground).toHaveBeenCalled();
  });

  it('start() registers the background-location task only when permission is granted', async () => {
    mockRequestBackground.mockResolvedValue({ status: 'granted' });
    await service.start();
    expect(mockStartLocationUpdates).toHaveBeenCalled();
  });

  it('start() skips the background-location task when permission is denied', async () => {
    mockRequestBackground.mockResolvedValue({ status: 'denied' });
    await service.start();
    expect(mockStartLocationUpdates).not.toHaveBeenCalled();
    // Not running background is non-fatal — isRunning still reflects the toggle.
    expect(service.isRunning).toBe(true);
  });

  it('start() is idempotent — a second call does not double-register the task', async () => {
    mockRequestBackground.mockResolvedValue({ status: 'granted' });
    await service.start();
    await service.start();
    expect(mockStartLocationUpdates).toHaveBeenCalledTimes(1);
  });

  it('stop() clears isRunning, stops the task, and stops any in-flight speech', async () => {
    mockRequestBackground.mockResolvedValue({ status: 'granted' });
    await service.start();
    expect(service.isRunning).toBe(true);

    await service.stop();
    expect(service.isRunning).toBe(false);
    expect(mockStopLocationUpdates).toHaveBeenCalled();
    expect(mockSpeechStop).toHaveBeenCalled();
  });

  it('handleBackgroundLocation emits location_update while running', async () => {
    mockRequestBackground.mockResolvedValue({ status: 'granted' });
    await service.start();

    await service.handleBackgroundLocation(BASE);

    const updates = events.filter((e) => e.type === 'location_update');
    expect(updates.length).toBe(1);
    expect(updates[0].gps).toEqual(BASE);
  });

  it('handleBackgroundLocation is a no-op when the service is stopped', async () => {
    await service.handleBackgroundLocation(BASE);
    expect(events.length).toBe(0);
  });

  it('does not run inference itself (delegated to ChatScreen / useProximityNarration)', async () => {
    // Regression guard: the old triage loop was pulled out precisely because
    // it competed with the POI-proximity narration path on the engine's single
    // session slot, causing "FAILED_PRECONDITION: a session already exists".
    // If a future refactor accidentally reintroduces an inference call here,
    // the 'interesting' / 'speaking' events would come back too.
    mockRequestBackground.mockResolvedValue({ status: 'granted' });
    await service.start();
    await service.handleBackgroundLocation(BASE);

    expect(events.filter((e) => e.type === 'interesting')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'speaking')).toHaveLength(0);
  });
});
