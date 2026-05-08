import type { GPSContext } from './InferenceService';
import { speechService } from './SpeechService';

// TODO: re-enable background-location task for v1.1 with Play submission narrative.
// ACCESS_BACKGROUND_LOCATION was removed from the manifest for v1.0 to avoid
// Play Store's written/video justification requirement. When re-enabling:
//   1. Restore ACCESS_BACKGROUND_LOCATION in AndroidManifest.xml + app.json.
//   2. Un-comment the expo-task-manager / expo-location imports below.
//   3. Un-comment the startLocationUpdatesAsync call in start().
//   4. Un-comment the TaskManager.defineTask block at the bottom of this file.
//   5. Add AppState gating to avoid background battery drain when app is suspended.
//
// import { AppState } from 'react-native';
// import * as Location from 'expo-location';
// import * as TaskManager from 'expo-task-manager';
//
// const BACKGROUND_LOCATION_TASK = 'background-location-task';

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
//   - emits location_update events through the listener interface so
//     useAutoGuide keeps latestGps fresh (foreground-only for v1.0).
// The old triage-prompt path competed with the POI flow on the engine's single
// session slot and was the root of "FAILED_PRECONDITION: a session already
// exists" errors; removing it is what lets both paths coexist safely.
//
// Background-location updates (startLocationUpdatesAsync via expo-task-manager)
// are disabled for v1.0. The foreground watchPositionAsync in useLocation.ts
// continues to drive narration while the app is in the foreground.

let running = false;
let listener: AutoGuideCallback | null = null;

function emit(event: AutoGuideEvent): void {
  listener?.(event);
}

export const autoGuideService = {
  setListener(cb: AutoGuideCallback | null): void {
    listener = cb;
  },

  async start(): Promise<void> {
    if (running) return;
    running = true;

    // Background-location task disabled for v1.0 (no ACCESS_BACKGROUND_LOCATION).
    // useLocation's foreground watchPositionAsync still drives narration while
    // the app is active.
    //
    // TODO: re-enable for v1.1 with Play submission narrative:
    // try {
    //   const bgStatus = await Location.requestBackgroundPermissionsAsync();
    //   if (bgStatus.status === 'granted') {
    //     await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    //       accuracy: Location.Accuracy.Balanced,
    //       timeInterval: 30_000,
    //       distanceInterval: 50,
    //       showsBackgroundLocationIndicator: true,
    //       foregroundService: {
    //         notificationTitle: 'Local Guide',
    //         notificationBody: 'Watching for interesting places nearby',
    //       },
    //     });
    //   }
    // } catch {
    //   // Background location unavailable — fine, foreground path still works.
    // }
  },

  async stop(): Promise<void> {
    running = false;
    // TODO: re-enable for v1.1:
    // try {
    //   const hasTask = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
    //   if (hasTask) {
    //     await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    //   }
    // } catch {
    //   // ignore
    // }
    speechService.stop();
  },

  get isRunning(): boolean {
    return running;
  },

  async handleBackgroundLocation(gps: GPSContext): Promise<void> {
    if (!running) return;
    emit({ type: 'location_update', gps });
  },
};

// TODO: re-enable for v1.1 with Play submission narrative:
// TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
//   if (error) return;
//   const locations = (data as { locations?: Location.LocationObject[] })?.locations;
//   if (!locations?.length) return;
//   const loc = locations[0];
//   await autoGuideService.handleBackgroundLocation({
//     latitude: loc.coords.latitude,
//     longitude: loc.coords.longitude,
//     accuracy: loc.coords.accuracy ?? undefined,
//   });
// });
