// Google Maps configuration helper. Exposes isConfigured() so UI components
// (e.g. MapScreen) can gate the native MapView on whether a key is present.
import Constants from 'expo-constants';

function readApiKey(): string | null {
  // Prefer EXPO_PUBLIC_GOOGLE_MAPS_API_KEY so the same .env value drives both
  // the native MapView gate (MapScreen) and the Directions REST call here —
  // one source of truth, no risk of drift. Fall back to app.json's
  // extra.googleMapsApiKey for callers that prefer Expo config injection.
  const fromEnv = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return fromEnv.trim();
  const raw = (Constants.expoConfig?.extra as Record<string, unknown> | undefined)
    ?.googleMapsApiKey;
  if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
  return null;
}

export const mapsService = {
  isConfigured(): boolean {
    return readApiKey() !== null;
  },
};
