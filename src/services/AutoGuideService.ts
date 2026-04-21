import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { GPSContext } from './InferenceService';
import { speechService } from './SpeechService';

const BACKGROUND_LOCATION_TASK = 'background-location-task';

type AutoGuideCallback = (event: AutoGuideEvent) => void;

export interface AutoGuideEvent {
  type: 'location_update' | 'interesting' | 'nothing' | 'error' | 'speaking';
  gps?: GPSContext;
  text?: string;
  durationMs?: number;
}

// As of the POI-based narration refactor, AutoGuideService no longer runs any
// inference itself. The ChatScreen drives narration via useProximityNarration
// (Wikipedia POIs + distance checks) + a one-shot "welcome" on enable. This
// service now only:
//   - gates background-location permission on Auto-Guide being on
//   - lets the background location task emit location_update events through
//     the same listener interface so useAutoGuide keeps latestGps fresh when
//     the app is backgrounded.
// The old triage-prompt path competed with the POI flow on the engine's single
// session slot and was the root of "FAILED_PRECONDITION: a session already
// exists" errors; removing it is what lets both paths coexist safely.
class AutoGuideService {
  private running = false;
  private listener: AutoGuideCallback | null = null;

  setListener(cb: AutoGuideCallback | null) {
    this.listener = cb;
  }

  private emit(event: AutoGuideEvent) {
    this.listener?.(event);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const bgStatus = await Location.requestBackgroundPermissionsAsync();
      if (bgStatus.status === 'granted') {
        await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 30_000,
          distanceInterval: 50,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: 'Local Guide',
            notificationBody: 'Watching for interesting places nearby',
          },
        });
      }
    } catch {
      // Background location unavailable (Expo Go, simulator, denied) — fine,
      // useLocation's foreground watchPositionAsync still drives narration.
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    try {
      const hasTask = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
      if (hasTask) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      }
    } catch {
      // ignore
    }
    speechService.stop();
  }

  get isRunning(): boolean {
    return this.running;
  }

  async handleBackgroundLocation(gps: GPSContext): Promise<void> {
    if (!this.running) return;
    this.emit({ type: 'location_update', gps });
  }
}

export const autoGuideService = new AutoGuideService();

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const locations = (data as { locations?: Location.LocationObject[] })?.locations;
  if (!locations?.length) return;
  const loc = locations[0];
  await autoGuideService.handleBackgroundLocation({
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    accuracy: loc.coords.accuracy ?? undefined,
  });
});
