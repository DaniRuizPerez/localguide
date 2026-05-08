/**
 * AutoGuideService — post-refactor behavior (v1.0 foreground-only).
 *
 * Background-location (startLocationUpdatesAsync) was disabled for v1.0 to
 * avoid ACCESS_BACKGROUND_LOCATION Play Store scrutiny. The service now only:
 *   - flips isRunning on start / off on stop
 *   - forwards location_update events to the listener via handleBackgroundLocation
 *     (still used by useAutoGuide when the foreground watchPositionAsync emits)
 * Tests pin this narrower contract.
 *
 * TODO: restore background-permission / startLocationUpdatesAsync tests in v1.1.
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
  });

  afterEach(async () => {
    await service.stop();
  });

  it('start() flips isRunning on', async () => {
    await service.start();
    expect(service.isRunning).toBe(true);
  });

  it('start() is idempotent — a second call does not double-register', async () => {
    await service.start();
    await service.start();
    expect(service.isRunning).toBe(true);
  });

  it('stop() clears isRunning and stops any in-flight speech', async () => {
    await service.start();
    expect(service.isRunning).toBe(true);

    await service.stop();
    expect(service.isRunning).toBe(false);
    expect(mockSpeechStop).toHaveBeenCalled();
  });

  it('handleBackgroundLocation emits location_update while running', async () => {
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
    await service.start();
    await service.handleBackgroundLocation(BASE);

    expect(events.filter((e) => e.type === 'interesting')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'speaking')).toHaveLength(0);
  });
});
