export type Units = 'km' | 'miles';

const METERS_PER_MILE = 1609.344;

export function formatDistance(meters: number, units: Units): string {
  if (units === 'miles') {
    const mi = meters / METERS_PER_MILE;
    if (mi < 0.1) return `${Math.round(meters * 3.2808)} ft`; // very short → feet
    if (mi < 10) return `${mi.toFixed(1)} mi`;
    return `${Math.round(mi)} mi`;
  }
  // km
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/** Format a radius value as a clean integer in the chosen unit (no decimals). */
export function formatRadius(meters: number, units: Units): string {
  if (units === 'miles') {
    const mi = Math.round(meters / METERS_PER_MILE);
    return `${mi} mi`;
  }
  const km = Math.round(meters / 1000);
  return `${km} km`;
}
