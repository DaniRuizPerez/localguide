import { useEffect, useRef } from 'react';
import type { GPSContext } from '../services/InferenceService';
import { distanceMeters, type Poi } from '../services/PoiService';

// Fires onNarrate when the user walks within PROXIMITY_THRESHOLD_METERS of a
// not-yet-narrated POI, with a MIN_INTERVAL_MS cooldown between triggers so a
// dense cluster of landmarks (e.g. a university campus) doesn't chain-fire.
//
// The "already narrated" set lives in a ref — intentionally NOT persisted
// across sessions. If the user reopens the app they might want to hear about
// nearby places again; keeping it in memory means each session gets a fresh
// tour. The one scenario this gets wrong is hot-reload, which is fine.
const PROXIMITY_THRESHOLD_METERS = 120;
const MIN_INTERVAL_MS = 30_000;

export function useProximityNarration(params: {
  gps: GPSContext | null;
  pois: Poi[];
  onNarrate: (poi: Poi) => void;
  enabled: boolean;
}) {
  const { gps, pois, enabled, onNarrate } = params;

  const narratedRef = useRef<Set<number>>(new Set());
  const lastTriggerRef = useRef(0);
  const onNarrateRef = useRef(onNarrate);

  useEffect(() => {
    onNarrateRef.current = onNarrate;
  }, [onNarrate]);

  // Reset the "already narrated" set when the feature is turned off. That way
  // each fresh Auto-Guide session can re-narrate the same POIs (e.g. user
  // toggled it off during a coffee break, walks back past the same landmark,
  // turns it back on — they probably want to hear about it again).
  useEffect(() => {
    if (!enabled) {
      narratedRef.current.clear();
      lastTriggerRef.current = 0;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (!gps) return;
    if (pois.length === 0) return;

    const now = Date.now();
    if (now - lastTriggerRef.current < MIN_INTERVAL_MS) return;

    let closest: { poi: Poi; distance: number } | null = null;
    for (const p of pois) {
      // LLM-sourced POIs don't carry real coordinates (their lat/lon are
      // placeholders copied from the user's own position), so a naïve distance
      // check would fire immediately for every one of them.
      if (p.source !== 'wikipedia') continue;
      if (narratedRef.current.has(p.pageId)) continue;
      const d = distanceMeters(gps.latitude, gps.longitude, p.latitude, p.longitude);
      if (d > PROXIMITY_THRESHOLD_METERS) continue;
      if (!closest || d < closest.distance) closest = { poi: p, distance: d };
    }

    if (!closest) return;

    narratedRef.current.add(closest.poi.pageId);
    lastTriggerRef.current = now;
    onNarrateRef.current(closest.poi);
  }, [gps, pois, enabled]);
}
