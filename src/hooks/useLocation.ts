import { useState, useEffect, useCallback, useRef } from 'react';
import * as Location from 'expo-location';
import type { GPSContext } from '../services/InferenceService';

export type LocationStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'error';

export interface LocationState {
  gps: GPSContext | null;
  status: LocationStatus;
  errorMessage: string | null;
  refresh: () => Promise<void>;
  manualLocation: string | null;
  setManualLocation: (placeName: string) => void;
}

// High accuracy so the chip list / proximity trigger lock onto the right
// neighborhood quickly — Balanced can stall on ±500 m fixes indoors and that
// drifts the Wikipedia radius enough to miss the actual nearby landmarks.
const LOCATION_OPTIONS: Location.LocationOptions = {
  accuracy: Location.Accuracy.High,
};

// Emit a new position when the user moves at least this far or this much time
// has passed. Walking pace is ~1.4 m/s, so 20 m ≈ every 14 s when moving and
// 5 s when idle keeps the chip list / proximity trigger fresh without burning
// battery on GPS ticks that don't change the app's view of the world.
const WATCH_OPTIONS: Location.LocationOptions = {
  accuracy: Location.Accuracy.High,
  distanceInterval: 20,
  timeInterval: 5000,
};

// Reverse-geocode the rounded fix (~110 m grid) once per unique grid cell so
// we don't spam the geocoder as the user walks. City/neighborhood resolution
// is stable at this grid size.
const geocodeCache = new Map<string, string>();
function geocodeKey(lat: number, lon: number): string {
  return `${lat.toFixed(3)}_${lon.toFixed(3)}`;
}

async function resolvePlaceName(lat: number, lon: number): Promise<string | null> {
  const key = geocodeKey(lat, lon);
  const cached = geocodeCache.get(key);
  if (cached !== undefined) return cached || null;
  try {
    const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
    const first = results[0];
    if (!first) {
      geocodeCache.set(key, '');
      return null;
    }
    // City + region ("Palo Alto, California") is the most useful anchor for
    // the LLM. `name` is often a street number and `district` a micro-hood —
    // both confuse the 1B model more than they help. Fall back through
    // subregion/country if city is missing (rural or international).
    const city = pickNonEmpty(first.city, first.subregion);
    const region = pickNonEmpty(first.region, first.country);
    const label =
      city && region && city !== region
        ? `${city}, ${region}`
        : city || region || pickNonEmpty(first.district, first.name) || null;
    geocodeCache.set(key, label ?? '');
    return label;
  } catch {
    return null;
  }
}

function pickNonEmpty(...candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    if (c && c.length > 0) return c;
  }
  return null;
}

export function useLocation(): LocationState {
  const [rawGps, setRawGps] = useState<GPSContext | null>(null);
  const [placeName, setPlaceName] = useState<string | null>(null);
  const [status, setStatus] = useState<LocationStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [manualLocation, setManualLocation] = useState<string | null>(null);
  const watchSubscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const lastGeocodeKeyRef = useRef<string | null>(null);

  // Re-geocode only when the rounded grid cell changes. Called from every
  // setGps path so both one-shot and watchPosition updates feed it.
  const maybeGeocode = useCallback((lat: number, lon: number) => {
    const key = geocodeKey(lat, lon);
    if (lastGeocodeKeyRef.current === key) return;
    lastGeocodeKeyRef.current = key;
    resolvePlaceName(lat, lon).then((name) => {
      // Guard against a stale resolve landing after the user has walked to a
      // new cell (a newer call set lastGeocodeKeyRef to something else).
      if (lastGeocodeKeyRef.current === key) setPlaceName(name);
    });
  }, []);

  const applyCoords = useCallback(
    (lat: number, lon: number, accuracy: number | undefined) => {
      setRawGps({ latitude: lat, longitude: lon, accuracy });
      maybeGeocode(lat, lon);
    },
    [maybeGeocode]
  );

  const startWatch = useCallback(async () => {
    // Idempotent: if a watch is already running (e.g. the user hit Retry after
    // a transient error), tear it down first so we don't end up with two
    // subscriptions fighting over setGps.
    watchSubscriptionRef.current?.remove();
    watchSubscriptionRef.current = null;
    try {
      watchSubscriptionRef.current = await Location.watchPositionAsync(
        WATCH_OPTIONS,
        (loc) => {
          applyCoords(
            loc.coords.latitude,
            loc.coords.longitude,
            loc.coords.accuracy ?? undefined
          );
        }
      );
    } catch {
      // Watch failure is non-fatal; the one-shot getCurrentPositionAsync
      // result still gives the UI a position to work with.
    }
  }, [applyCoords]);

  const fetchLocation = useCallback(async () => {
    setStatus('requesting');
    setErrorMessage(null);

    try {
      const { status: permStatus } = await Location.requestForegroundPermissionsAsync();
      if (permStatus !== 'granted') {
        setStatus('denied');
        setErrorMessage('Location permission denied. Enable it in Settings to use the guide.');
        return;
      }

      const loc = await Location.getCurrentPositionAsync(LOCATION_OPTIONS);
      applyCoords(
        loc.coords.latitude,
        loc.coords.longitude,
        loc.coords.accuracy ?? undefined
      );
      setStatus('ready');
      // Kick off live updates so proximity-triggered narration and the nearby-
      // attractions chip list can react as the user walks. Fire-and-forget: if
      // this throws, the one-shot position above still keeps the UI functional.
      startWatch();
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Failed to get location');
    }
  }, [applyCoords, startWatch]);

  useEffect(() => {
    fetchLocation();
    return () => {
      watchSubscriptionRef.current?.remove();
      watchSubscriptionRef.current = null;
    };
  }, [fetchLocation]);

  // Merge placeName into gps so all downstream consumers (ChatScreen, Wikipedia
  // lookup, LLM prompt) see the richer context without having to stitch two
  // state shards together.
  const gps: GPSContext | null = rawGps
    ? placeName
      ? { ...rawGps, placeName }
      : rawGps
    : null;

  return { gps, status, errorMessage, refresh: fetchLocation, manualLocation, setManualLocation };
}
