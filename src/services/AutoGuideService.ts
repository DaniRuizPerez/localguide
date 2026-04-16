import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { inferenceService, type GPSContext } from './InferenceService';
import { speechService } from './SpeechService';
import { POLL_INTERVAL_MS, MIN_DISTANCE_METERS, TRIAGE_MAX_TOKENS } from '../config/constants';
import { buildPrompt } from './prompt';

const BACKGROUND_LOCATION_TASK = 'background-location-task';

const TRIAGE_SYSTEM_PROMPT =
  'You are a local tourist guide. Given GPS coordinates, decide if this location is near anything interesting ' +
  '(landmark, historic site, notable restaurant, scenic viewpoint, cultural spot, etc.). ' +
  'If YES: describe what is nearby in 2-3 sentences. If NOTHING interesting, respond with exactly "NOTHING".';

export type AutoGuideCallback = (event: AutoGuideEvent) => void;

export interface AutoGuideEvent {
  type: 'location_update' | 'interesting' | 'nothing' | 'error' | 'speaking';
  gps?: GPSContext;
  text?: string;
  durationMs?: number;
}

function haversineDistance(a: GPSContext, b: GPSContext): number {
  const R = 6371e3;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * sinLon * sinLon;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

class AutoGuideService {
  private running = false;
  private lastGps: GPSContext | null = null;
  private foregroundTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<AutoGuideCallback>();
  private taskDefined = false;

  addListener(cb: AutoGuideCallback): void {
    this.listeners.add(cb);
  }

  removeListener(cb: AutoGuideCallback): void {
    this.listeners.delete(cb);
  }

  private emit(event: AutoGuideEvent): void {
    this.listeners.forEach((cb) => cb(event));
  }

  async start(): Promise<void> {
    if (this.running) return;

    // Register background task handler on first start, not at module load time
    if (!this.taskDefined) {
      TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
        if (error) return;
        if (data == null || typeof data !== 'object' || !('locations' in data)) return;
        const locations = (data as { locations?: Location.LocationObject[] }).locations;
        if (!locations?.length) return;
        const loc = locations[0];
        await this.handleBackgroundLocation({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          accuracy: loc.coords.accuracy ?? undefined,
        });
      });
      this.taskDefined = true;
    }

    this.running = true;

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      this.emit({ type: 'error', text: 'Location permission denied' });
      this.running = false;
      return;
    }

    await this.pollOnce();
    this.foregroundTimer = setInterval(() => this.pollOnce(), POLL_INTERVAL_MS);

    try {
      const bgStatus = await Location.requestBackgroundPermissionsAsync();
      if (bgStatus.status === 'granted') {
        await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: POLL_INTERVAL_MS,
          distanceInterval: MIN_DISTANCE_METERS,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: 'Local Guide',
            notificationBody: 'Watching for interesting places nearby',
          },
        });
      }
    } catch {
      // Background location not available — foreground polling still works
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.foregroundTimer) {
      clearInterval(this.foregroundTimer);
      this.foregroundTimer = null;
    }
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
    await this.evaluateLocation(gps);
  }

  private async pollOnce(): Promise<void> {
    if (!this.running) return;
    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const gps: GPSContext = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        accuracy: loc.coords.accuracy ?? undefined,
      };
      this.emit({ type: 'location_update', gps });
      await this.evaluateLocation(gps);
    } catch (err) {
      this.emit({ type: 'error', text: err instanceof Error ? err.message : 'Location poll failed' });
    }
  }

  private async evaluateLocation(gps: GPSContext): Promise<void> {
    if (!this.lastGps) {
      // Establish baseline on first fix; skip inference so we only speak when the user moves
      this.lastGps = gps;
      this.emit({ type: 'nothing', gps });
      return;
    }

    if (haversineDistance(this.lastGps, gps) < MIN_DISTANCE_METERS) {
      this.emit({ type: 'nothing', gps });
      return;
    }

    try {
      const prompt = buildPrompt(TRIAGE_SYSTEM_PROMPT, gps);
      // Update baseline before inference so concurrent evaluations don't double-fire
      this.lastGps = gps;
      const start = Date.now();
      const response = await inferenceService.runInference(prompt, { maxTokens: TRIAGE_MAX_TOKENS });
      const durationMs = Date.now() - start;
      const trimmed = response.trim();

      if (trimmed.toUpperCase().startsWith('NOTHING')) {
        this.emit({ type: 'nothing', gps, durationMs });
        return;
      }

      this.emit({ type: 'interesting', gps, text: trimmed, durationMs });
      this.emit({ type: 'speaking', gps, text: trimmed });
      await speechService.speak(trimmed);
    } catch (err) {
      this.emit({ type: 'error', text: err instanceof Error ? err.message : 'Inference failed' });
    }
  }
}

import type { IAutoGuideService } from '../types/services';

export const autoGuideService: IAutoGuideService = new AutoGuideService();
