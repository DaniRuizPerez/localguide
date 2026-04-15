import { useState, useEffect, useCallback } from 'react';
import * as Location from 'expo-location';
import type { GPSContext } from '../services/InferenceService';

export type LocationStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'error';

export interface LocationState {
  gps: GPSContext | null;
  status: LocationStatus;
  errorMessage: string | null;
  refresh: () => Promise<void>;
}

const LOCATION_OPTIONS: Location.LocationOptions = {
  accuracy: Location.Accuracy.Balanced,
};

export function useLocation(): LocationState {
  const [gps, setGps] = useState<GPSContext | null>(null);
  const [status, setStatus] = useState<LocationStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
      setGps({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        accuracy: loc.coords.accuracy ?? undefined,
      });
      setStatus('ready');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Failed to get location');
    }
  }, []);

  useEffect(() => {
    fetchLocation();
  }, [fetchLocation]);

  return { gps, status, errorMessage, refresh: fetchLocation };
}
