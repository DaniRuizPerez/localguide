// Enriches a ranked POI list with OSRM-routed walking distances/times.
//
// Why this exists: `Poi.distanceMeters` is Haversine ("as the crow flies"),
// which underestimates real walking distance — sometimes by 30–50% in dense
// urban grids. We keep Haversine for the radius filter + sort (cheap,
// deterministic, available immediately) and overlay OSRM walking metres for
// display once the matrix lands.
//
// Free path: OSRM public demo server, cached in-memory + AsyncStorage 24 h.
// Single matrix call per fresh ranked list. LLM-source POIs are skipped
// (placeholder coords = user GPS would poison the matrix).

import { useEffect, useState } from 'react';
import { type Poi } from '../services/PoiService';
import { type GPSContext } from '../services/InferenceService';
import { routeService } from '../services/RouteService';

interface Result {
  /** Same array shape as input; each Poi may gain walkingMeters/walkingMinutes. */
  enriched: Poi[];
  /** True while the OSRM call is in flight. */
  loading: boolean;
}

export function useWalkingDistances(pois: Poi[], gps: GPSContext | null): Result {
  const [enriched, setEnriched] = useState<Poi[]>(pois);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // No GPS or no POIs → expose the input unchanged.
    if (!gps || pois.length === 0) {
      setEnriched(pois);
      setLoading(false);
      return;
    }

    // LLM POIs have placeholder coords (user's GPS); they would crowd OSRM
    // with a row/col of zeros. Strip them before the call, re-attach after.
    const realPois = pois.filter((p) => p.source !== 'llm');
    const llmPois = pois.filter((p) => p.source === 'llm');
    if (realPois.length === 0) {
      setEnriched(pois);
      setLoading(false);
      return;
    }

    const coords = [
      { lat: gps.latitude, lon: gps.longitude },
      ...realPois.map((p) => ({ lat: p.latitude, lon: p.longitude })),
    ];

    let cancelled = false;
    setLoading(true);

    const controller = new AbortController();
    routeService
      .walkingTimeMatrix(coords, { signal: controller.signal })
      .then((matrix) => {
        if (cancelled) return;
        if (!matrix) {
          // OSRM failure — leave the input unchanged so display falls back
          // to Haversine distanceMeters.
          setEnriched(pois);
          setLoading(false);
          return;
        }
        // Row 0 = user → each POI. realPois[i] corresponds to coords[i+1].
        const enrichedReal = realPois.map((p, i) => ({
          ...p,
          walkingMeters: matrix.meters[0]?.[i + 1],
          walkingMinutes: matrix.minutes[0]?.[i + 1],
        }));
        // Re-merge llm POIs preserving the original order (rank order).
        const realIds = new Set(enrichedReal.map((p) => `${p.source}-${p.pageId}`));
        const merged: Poi[] = pois.map((orig) => {
          const key = `${orig.source}-${orig.pageId}`;
          if (!realIds.has(key)) return orig;
          return enrichedReal.find((p) => `${p.source}-${p.pageId}` === key) ?? orig;
        });
        // Compatibility note for non-llm entries: merged[] preserves the
        // original positions but only updates the real POIs with walking data.
        // The find() above is O(N²) over realPois, but realPois.length <= 15.
        if (merged.length === 0 && llmPois.length > 0) {
          // Defensive: shouldn't happen, but if pois had only llm entries
          // we already returned early above. No-op.
        }
        setEnriched(merged);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setEnriched(pois);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // Stringify a stable identifier of the ranked list so we don't refetch
    // on every render — only when the actual content changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    gps?.latitude.toFixed(4),
    gps?.longitude.toFixed(4),
    pois.map((p) => `${p.source}-${p.pageId}`).join(','),
  ]);

  return { enriched, loading };
}
