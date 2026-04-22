import { useEffect, useRef, useState } from 'react';
import { distanceMeters, poiService, type Poi } from '../services/PoiService';
import { type GPSContext } from '../services/InferenceService';
import { localGuideService, type ListPlacesTask } from '../services/LocalGuideService';

interface Options {
  /** When true, rank hidden gems (shorter Wikipedia articles) first. */
  hiddenGems?: boolean;
  /**
   * When true, skip Wikipedia entirely and go straight to the on-device LLM.
   * Honors the user's offline-mode toggle.
   */
  offline?: boolean;
}

interface Result {
  pois: Poi[];
  loading: boolean;
}

interface LlmCacheEntry {
  at: number;
  pois: Poi[];
}

const LLM_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Fetch nearby POIs for the current GPS fix. Prefers Wikipedia (real coords,
 * safe to geofence); falls back to the on-device LLM if Wikipedia is offline
 * or returns nothing. LLM-suggested POIs carry placeholder coordinates (the
 * user's own position) and source='llm' — consumers that need real positions
 * (proximity narration, compass target) must skip them.
 */
export function useNearbyPois(
  gps: GPSContext | null,
  radiusMeters: number,
  options: Options = {}
): Result {
  const { hiddenGems = false, offline = false } = options;
  const [pois, setPois] = useState<Poi[]>([]);
  const [loading, setLoading] = useState(false);

  const llmCacheRef = useRef<Map<string, LlmCacheEntry>>(new Map());
  const llmFallbackTaskRef = useRef<ListPlacesTask | null>(null);

  useEffect(() => {
    if (!gps) return;
    let cancelled = false;

    const cellKey = `${gps.latitude.toFixed(3)}_${gps.longitude.toFixed(3)}_${radiusMeters}`;
    setPois([]);
    setLoading(true);

    poiService
      .fetchNearby(gps.latitude, gps.longitude, radiusMeters, undefined, { hiddenGems, offline })
      .then(async (raw) => {
        if (cancelled) return;
        const sorted = raw
          .map((p) => ({
            ...p,
            distanceMeters: distanceMeters(gps.latitude, gps.longitude, p.latitude, p.longitude),
          }))
          .filter((p) => p.distanceMeters <= radiusMeters)
          .sort((a, b) => a.distanceMeters - b.distanceMeters);

        if (sorted.length > 0) {
          setPois(sorted);
          return;
        }

        // Wikipedia gave us nothing (offline mode, offline network, or simply
        // no matching articles) — fall through to the on-device LLM. We keep
        // `loading` true through this path so the user sees a single "looking
        // around you" state instead of the misleading "walk around" empty
        // state flashing up while the model generates.
        const cached = llmCacheRef.current.get(cellKey);
        if (cached && Date.now() - cached.at < LLM_CACHE_TTL_MS) {
          setPois(cached.pois);
          return;
        }
        if (llmFallbackTaskRef.current) {
          await llmFallbackTaskRef.current.abort();
          llmFallbackTaskRef.current = null;
        }
        const task = localGuideService.listNearbyPlaces(gps, radiusMeters);
        llmFallbackTaskRef.current = task;
        try {
          const names = await task.promise;
          if (cancelled) return;
          const llmPois: Poi[] = names.map((name, i) => ({
            pageId: -(Date.now() + i),
            title: name,
            latitude: gps.latitude,
            longitude: gps.longitude,
            distanceMeters: 0,
            source: 'llm',
          }));
          llmCacheRef.current.set(cellKey, { at: Date.now(), pois: llmPois });
          setPois(llmPois);
        } catch {
          // aborted or inference error — leave pois empty
        } finally {
          if (llmFallbackTaskRef.current === task) {
            llmFallbackTaskRef.current = null;
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gps && gps.latitude.toFixed(3), gps && gps.longitude.toFixed(3), radiusMeters, hiddenGems, offline]);

  return { pois, loading };
}
