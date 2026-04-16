import type { GPSContext } from './InferenceService';

export function formatCoordinates(gps: GPSContext, includeAccuracy = false): string {
  const coords = `${gps.latitude.toFixed(6)}, ${gps.longitude.toFixed(6)}`;
  if (includeAccuracy && gps.accuracy != null) {
    return `${coords} (±${Math.round(gps.accuracy)}m)`;
  }
  return coords;
}

export function buildPrompt(
  systemPrompt: string,
  gps: GPSContext,
  options: { includeAccuracy?: boolean; userQuery?: string } = {}
): string {
  const coords = formatCoordinates(gps, options.includeAccuracy);
  const userLine = options.userQuery !== undefined ? `\nUser: ${options.userQuery}` : '';
  return `${systemPrompt}\n\nCurrent location: ${coords}${userLine}\nGuide:`;
}
