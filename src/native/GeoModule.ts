/**
 * Native bridge for the on-device reverse-geocoder + country-pack manager.
 *
 * Native setup required:
 *   Android: Kotlin module registered as "GeoModule" that ships a bundled
 *            cities15000 SQLite database in assets and downloads per-country
 *            packs to internal storage on demand.
 *   iOS:     not yet implemented — `NativeModules.GeoModule` is undefined and
 *            this bridge falls back to the no-op shim below.
 *
 * The bridge contract intentionally mirrors `LiteRTModule.ts`: a typed
 * interface, a small subscriber-friendly fallback shim when the native module
 * isn't present (so Jest tests don't crash), and named string constants for
 * each event so callers don't sprinkle magic strings.
 */

import { NativeEventEmitter, NativeModules } from 'react-native';
import type { EmitterSubscription } from 'react-native';

export interface GeoPlace {
  name: string;
  asciiname: string;
  admin1: string | null;
  admin1Name: string | null;
  admin2: string | null;
  countryCode: string;
  countryName: string | null;
  featureCode: string | null;
  population: number;
  lat: number;
  lon: number;
  distanceMeters: number;
  /** "cities15000" or "country:US" — which DB the row came from. */
  source: string;
}

export interface GeoCurrentLocation {
  lat: number;
  lon: number;
  accuracyMeters: number;
  ageMs: number;
  provider: string;
}

export interface GeoCountryPackAvailable {
  iso: string;
  name: string;
  sizeBytes: number;
  snapshotDate: string;
}

export interface GeoCountryPackInstalled {
  iso: string;
  snapshotDate: string;
  sizeBytes: number;
}

export interface GeoReverseGeocodeOptions {
  preferCountryPack?: boolean;
}

export interface GeoCurrentLocationOptions {
  priority?: 'balanced' | 'high' | 'low';
  maxAgeMs?: number;
}

export interface GeoModuleNative {
  reverseGeocode(
    lat: number,
    lon: number,
    options?: GeoReverseGeocodeOptions
  ): Promise<GeoPlace | null>;

  getCurrentLocation(options?: GeoCurrentLocationOptions): Promise<GeoCurrentLocation>;

  availableCountryPacks(): Promise<GeoCountryPackAvailable[]>;

  installedCountryPacks(): Promise<GeoCountryPackInstalled[]>;

  installCountryPack(
    iso: string,
    downloadUrl: string,
    expectedSnapshotDate: string
  ): Promise<void>;

  uninstallCountryPack(iso: string): Promise<void>;

  // RCTEventEmitter parity methods; not called from application code.
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export const GEO_EVENT_PROGRESS = 'GeoPackProgress';
export const GEO_EVENT_ERROR = 'GeoPackError';
export const GEO_EVENT_COMPLETE = 'GeoPackComplete';

export type GeoPackPhase = 'download' | 'extract' | 'open';

export interface GeoPackProgressEvent {
  iso: string;
  phase: GeoPackPhase;
  bytesDownloaded?: number;
  bytesTotal?: number;
}

export interface GeoPackErrorEvent {
  iso: string;
  message: string;
}

export interface GeoPackCompleteEvent {
  iso: string;
}

const { GeoModule: NativeGeoModule } = NativeModules as {
  GeoModule?: GeoModuleNative;
};

if (!NativeGeoModule) {
  console.warn(
    '[GeoModule] Native module not found. ' +
      'Run `expo run:android` (not Expo Go) to enable on-device reverse geocoding. ' +
      'OfflineGeocoder will return null and callers will fall back to expo-location.'
  );
}

/**
 * No-op shim used when the native module isn't registered (Jest, Expo Go,
 * iOS until the Swift module ships). Every method resolves to a benign value
 * so callers can treat the absence as "no offline data available" without
 * special-casing every call site.
 */
const SHIM: GeoModuleNative = {
  reverseGeocode: () => Promise.resolve(null),
  getCurrentLocation: () =>
    Promise.reject(new Error('GeoModule native bridge not available')),
  availableCountryPacks: () => Promise.resolve([]),
  installedCountryPacks: () => Promise.resolve([]),
  installCountryPack: () =>
    Promise.reject(new Error('GeoModule native bridge not available')),
  uninstallCountryPack: () =>
    Promise.reject(new Error('GeoModule native bridge not available')),
  addListener: () => undefined,
  removeListeners: () => undefined,
};

const impl: GeoModuleNative = NativeGeoModule ?? SHIM;

/** True iff the native module is registered with React Native on this build. */
export function isGeoModuleAvailable(): boolean {
  return NativeGeoModule != null;
}

/**
 * Lazily-constructed event emitter. Built against the native module when
 * available; falls back to a stub emitter when it isn't, so `addListener`
 * calls in tests are no-ops instead of throwing.
 */
let cachedEmitter: NativeEventEmitter | null = null;
function getEmitter(): NativeEventEmitter {
  if (cachedEmitter) return cachedEmitter;
  // NativeEventEmitter requires a NativeModule on iOS; on Android the arg is
  // ignored. When the module is absent we hand it the SHIM, which carries the
  // same addListener/removeListeners shape.
  cachedEmitter = new NativeEventEmitter(NativeGeoModule ?? SHIM);
  return cachedEmitter;
}

export function addGeoPackProgressListener(
  listener: (event: GeoPackProgressEvent) => void
): EmitterSubscription {
  return getEmitter().addListener(GEO_EVENT_PROGRESS, listener);
}

export function addGeoPackErrorListener(
  listener: (event: GeoPackErrorEvent) => void
): EmitterSubscription {
  return getEmitter().addListener(GEO_EVENT_ERROR, listener);
}

export function addGeoPackCompleteListener(
  listener: (event: GeoPackCompleteEvent) => void
): EmitterSubscription {
  return getEmitter().addListener(GEO_EVENT_COMPLETE, listener);
}

export default impl;
