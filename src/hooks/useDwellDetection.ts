import { useEffect, useRef, useState } from 'react';
import type { GPSContext } from '../services/InferenceService';
import { distanceMeters, type Poi } from '../services/PoiService';

// B5 — Dwell detection. Fires `onDwell(poi)` when the user has been
// continuously within DWELL_RADIUS_METERS of a real POI for at least
// DWELL_DURATION_MS. Once fired for a POI, the user must leave and come
// back (or wait out the POI_COOLDOWN_MS) before the same place can
// re-trigger.
//
// Intent is different from useProximityNarration: that hook auto-narrates
// when walking past; this one waits for a prolonged visit (user sitting on
// a bench in a plaza, lingering in a museum lobby) and surfaces a gentle
// "want to hear about this?" prompt.

export const DWELL_RADIUS_METERS = 80;
export const DWELL_DURATION_MS = 2 * 60 * 1000;
export const POI_COOLDOWN_MS = 30 * 60 * 1000;

export interface DwellCandidate {
  poi: Poi;
  enteredAt: number;
}

export function useDwellDetection(params: {
  gps: GPSContext | null;
  pois: Poi[];
  onDwell?: (poi: Poi) => void;
  /** Override for tests. */
  now?: () => number;
  /** When false, no dwell events are emitted (still tracks internal state). */
  enabled?: boolean;
}): DwellCandidate | null {
  const { gps, pois, onDwell, now = Date.now, enabled = true } = params;

  // Per-POI state: when did the user enter the radius, and have we already
  // fired for this visit?
  // enteredAt=0 is the "user walked away" sentinel; lastFiredAt=-Infinity
  // means "never fired, no cooldown in effect".
  const stateRef = useRef<Map<number, { enteredAt: number; lastFiredAt: number }>>(new Map());

  const [triggered, setTriggered] = useState<DwellCandidate | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (!gps) return;
    if (pois.length === 0) return;

    const t = now();
    const currentRadius = new Set<number>();

    for (const p of pois) {
      // Skip LLM POIs (placeholder coords).
      if (p.source !== 'wikipedia') continue;
      const d = distanceMeters(gps.latitude, gps.longitude, p.latitude, p.longitude);
      if (d > DWELL_RADIUS_METERS) continue;

      currentRadius.add(p.pageId);
      let existing = stateRef.current.get(p.pageId);
      if (!existing) {
        existing = { enteredAt: t, lastFiredAt: Number.NEGATIVE_INFINITY };
        stateRef.current.set(p.pageId, existing);
        continue;
      }
      // If the user had walked out and the entry was cleared, start the
      // dwell timer fresh now.
      if (existing.enteredAt === 0) {
        existing.enteredAt = t;
        continue;
      }

      const dwelled = t - existing.enteredAt;
      const cooldownOk = t - existing.lastFiredAt >= POI_COOLDOWN_MS;
      if (dwelled >= DWELL_DURATION_MS && cooldownOk) {
        existing.lastFiredAt = t;
        setTriggered({ poi: p, enteredAt: existing.enteredAt });
        onDwell?.(p);
        // Keep `enteredAt` so repeated fixes while still-dwelling don't
        // immediately re-enter "entered" state. The cooldown prevents
        // re-firing.
      }
    }

    // POIs the user has walked away from — reset their enteredAt so a future
    // return starts a fresh dwell timer. Keep lastFiredAt so the cooldown
    // still applies until the window closes.
    for (const [pageId, state] of stateRef.current.entries()) {
      if (!currentRadius.has(pageId)) {
        state.enteredAt = 0;
      }
    }
  }, [gps, pois, enabled, now, onDwell]);

  // Also clear the triggered banner when the user leaves the POI's radius.
  useEffect(() => {
    if (!triggered || !gps) return;
    const d = distanceMeters(
      gps.latitude,
      gps.longitude,
      triggered.poi.latitude,
      triggered.poi.longitude
    );
    if (d > DWELL_RADIUS_METERS) {
      setTriggered(null);
    }
  }, [gps, triggered]);

  return triggered;
}

/** Test hook — consumers don't need to clear this manually. */
export function __clearDwellStateForTest(): void {
  // no-op; state is kept per hook instance. Included for parity with other
  // services and to make the test's intent clear.
}
