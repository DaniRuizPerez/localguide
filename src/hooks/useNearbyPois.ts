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
    if (!gps) {
      // Permission revoked (or not yet granted): discard any stale POIs that
      // were fetched when GPS was available and abort any in-flight LLM task.
      // Without this, the "Around you" list keeps showing names from the
      // previous session / location even after the user revokes permission.
      setPois([]);
      if (llmFallbackTaskRef.current) {
        llmFallbackTaskRef.current.abort().catch(() => {});
        llmFallbackTaskRef.current = null;
      }
      return;
    }
    let cancelled = false;

    const cellKey = `${gps.latitude.toFixed(3)}_${gps.longitude.toFixed(3)}_${radiusMeters}`;
    // Don't blank the list on grid-cell change; keep what's on screen until the
    // new fetch lands so the user doesn't see an empty flicker. The streaming
    // fetch below will paint a partial result (cache or GeoNames) within tens
    // of milliseconds, then the canonical Wikipedia list when it returns.
    setLoading(true);

    const sortAndFilter = (raw: Poi[]) =>
      raw
        .map((p) => ({
          ...p,
          distanceMeters: distanceMeters(gps.latitude, gps.longitude, p.latitude, p.longitude),
        }))
        .filter((p) => p.distanceMeters <= radiusMeters)
        .sort((a, b) => a.distanceMeters - b.distanceMeters);

    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log(
        `[NearbyPois] fetch start lat=${gps.latitude.toFixed(4)} lon=${gps.longitude.toFixed(4)} ` +
          `r=${radiusMeters}m hiddenGems=${hiddenGems} offline=${offline}`
      );
    }

    poiService
      .fetchNearbyStreaming(
        gps.latitude,
        gps.longitude,
        radiusMeters,
        undefined,
        { hiddenGems, offline },
        {
          // Partial emissions land before the full network round trip (cache
          // hit) or alongside it (offline GeoNames). Both carry real coords
          // we can geofence on — safe to feed straight into the Poi state.
          onPartial: (partial, stage) => {
            if (cancelled) return;
            const sorted = sortAndFilter(partial);
            if (__DEV__) {
              // eslint-disable-next-line no-console
              console.log(
                `[NearbyPois] partial '${stage}' raw=${partial.length} after-radius=${sorted.length}`
              );
            }
            if (sorted.length > 0) setPois(sorted);
          },
        }
      )
      .then(async (raw) => {
        if (cancelled) return;
        const sorted = sortAndFilter(raw);
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.log(
            `[NearbyPois] wikipedia raw=${raw.length} after-radius=${sorted.length}`
          );
        }

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
          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.log(`[NearbyPois] llm cache hit (${cached.pois.length})`);
          }
          setPois(cached.pois);
          return;
        }
        if (llmFallbackTaskRef.current) {
          await llmFallbackTaskRef.current.abort();
          llmFallbackTaskRef.current = null;
        }
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.log('[NearbyPois] llm fallback start');
        }
        const task = localGuideService.listNearbyPlaces(gps, radiusMeters);
        llmFallbackTaskRef.current = task;
        try {
          const names = await task.promise;
          if (cancelled) return;
          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.log(`[NearbyPois] llm fallback returned ${names.length} names`);
          }
          const llmPois: Poi[] = names.map((name, i) => ({
            pageId: -(Date.now() + i),
            title: name,
            latitude: gps.latitude,
            longitude: gps.longitude,
            distanceMeters: 0,
            source: 'llm',
          }));
          // Skip caching empty results: when Gemma drifts on a single call
          // (every-line filtered out by parsePlaceList, or simply produced
          // nothing) we'd otherwise pin the user to "[]" for the full
          // LLM_CACHE_TTL_MS even if the very next call would have come back
          // with real names. The model is non-deterministic — let the next
          // fetch try fresh.
          if (llmPois.length > 0) {
            llmCacheRef.current.set(cellKey, { at: Date.now(), pois: llmPois });
          }
          setPois(llmPois);
        } catch (err) {
          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.warn(`[NearbyPois] llm fallback error: ${(err as Error)?.message ?? err}`);
          }
        } finally {
          if (llmFallbackTaskRef.current === task) {
            llmFallbackTaskRef.current = null;
          }
        }
      })
      .catch((err) => {
        // fetchNearbyStreaming should swallow its own errors, but a stray
        // reject (e.g. a synchronous throw in a future change) would
        // otherwise leave `loading` true forever and the list permanently
        // empty. Log it so logcat can show what happened.
        // eslint-disable-next-line no-console
        console.warn(`[NearbyPois] fetch rejected: ${(err as Error)?.message ?? err}`);
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
