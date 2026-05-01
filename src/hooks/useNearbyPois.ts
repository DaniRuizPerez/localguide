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
  /**
   * When true, never run the LLM fallback even if geo results < TARGET_COUNT.
   * Online users get real POIs only — no AI-generated picks, no divider.
   */
  skipLlmFill?: boolean;
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
// Target number of "Around you" rows. We always show all real (geo /
// Wikipedia) results we got and only top up with LLM-sourced suggestions
// to reach this count. 6 matches the quiz + listNearbyPlaces conventions.
const TARGET_COUNT = 6;

/**
 * Append `extras` to `base` skipping anything whose title (case-insensitive)
 * already appears in base. Used to merge real geo POIs with LLM-suggested
 * ones without duplicates.
 */
function mergeUnique(base: Poi[], extras: Poi[]): Poi[] {
  const seen = new Set(base.map((p) => p.title.toLowerCase().trim()));
  const out = [...base];
  for (const extra of extras) {
    const key = extra.title.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(extra);
  }
  return out;
}

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
  const { hiddenGems = false, offline = false, skipLlmFill = false } = options;
  const [pois, setPois] = useState<Poi[]>([]);
  const [loading, setLoading] = useState(false);

  const llmCacheRef = useRef<Map<string, LlmCacheEntry>>(new Map());
  const llmFallbackTaskRef = useRef<ListPlacesTask | null>(null);
  // Position of the last *fetch* (not last GPS update). Used to skip refires
  // when the user hasn't really moved — protects the boundary case where
  // GPS jitter straddles a cell line (37.4249 ↔ 37.4250 with toFixed(2))
  // and would otherwise still cancel an in-flight LLM call.
  const lastFetchPosRef = useRef<{ lat: number; lon: number } | null>(null);
  const HYSTERESIS_METERS = 200;

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
    // Hysteresis: if an LLM fallback is already in flight for a position
    // within HYSTERESIS_METERS of the new GPS fix, let it finish instead of
    // restarting. This guards the cell-boundary case where GPS jitter
    // straddles 0.01° (e.g. 37.4249 ↔ 37.4250) and would otherwise still
    // cancel-and-restart the slow on-device LLM call for no real movement.
    const lastFetch = lastFetchPosRef.current;
    if (lastFetch && llmFallbackTaskRef.current) {
      const moved = distanceMeters(lastFetch.lat, lastFetch.lon, gps.latitude, gps.longitude);
      if (moved < HYSTERESIS_METERS) {
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.log(
            `[NearbyPois] skip refire — moved ${moved.toFixed(0)}m < ${HYSTERESIS_METERS}m hysteresis, llm in flight`
          );
        }
        return;
      }
    }
    lastFetchPosRef.current = { lat: gps.latitude, lon: gps.longitude };

    let cancelled = false;

    // Cell granularity dropped from toFixed(3) (~110m) to toFixed(2) (~1.1km).
    // toFixed(3) thrashed live: GPS jitter of 0.0001° around a cell boundary
    // (e.g. 37.4232 → 37.4235 → 37.4233) flipped the rounded key 37.423 ↔
    // 37.424 every few seconds, re-firing the effect, cancelling the
    // in-flight on-device LLM fallback, and immediately restarting it. That
    // turned a single ~2.5 min LLM call into an infinite cancel-and-retry
    // loop that also blocked every other inference (quiz, guide facts) from
    // ever completing. 1.1 km cells line up with the "Around you" radius
    // (typically 1 km) and can absorb normal GPS noise without changing.
    const cellKey = `${gps.latitude.toFixed(2)}_${gps.longitude.toFixed(2)}_${radiusMeters}`;
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
            `[NearbyPois] geo+wikipedia raw=${raw.length} after-radius=${sorted.length} target=${TARGET_COUNT}`
          );
        }

        // We always show whatever the geo path produced first — those names
        // are real and verified. Then if the list is short of TARGET_COUNT,
        // top it up with LLM-sourced suggestions (clearly labeled). When
        // geo returned 0 we skip straight to the LLM.
        if (sorted.length > 0) setPois(sorted);
        const llmFillCount = TARGET_COUNT - sorted.length;
        if (llmFillCount <= 0) return;
        if (skipLlmFill) {
          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.log(`[NearbyPois] online mode — skipping LLM fill (have ${sorted.length} real POIs)`);
          }
          return;
        }

        // Gate the LLM fallback on having a usable place name. Without it,
        // both the listNearbyPlaces prompt AND the verify prompt drop the
        // city anchor and we get generic East-Coast hallucinations
        // ("Lake George", "Lake Erie"). The hook will re-run once
        // reverse geocoding lands placeName (it's in the deps array).
        if (!gps.placeName) {
          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.log(
              '[NearbyPois] skipping LLM fallback — placeName not yet resolved by geocoder; will retry on next render'
            );
          }
          return;
        }

        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.log(
            `[NearbyPois] geo short ${sorted.length}/${TARGET_COUNT} — asking LLM for ${llmFillCount} more`
          );
        }

        const cached = llmCacheRef.current.get(cellKey);
        if (cached && Date.now() - cached.at < LLM_CACHE_TTL_MS) {
          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.log(`[NearbyPois] llm cache hit (${cached.pois.length})`);
          }
          // Combine geo (real) + cached LLM (warning), dedupe by title.
          setPois(mergeUnique(sorted, cached.pois.slice(0, llmFillCount)));
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
        let attempt = 0;
        let candidateNames: string[] = [];
        while (attempt < 2 && !cancelled) {
          if (attempt > 0 && __DEV__) {
            // eslint-disable-next-line no-console
            console.log(`[NearbyPois] llm retry ${attempt} (previous returned 0 names)`);
          }
          const task = localGuideService.listNearbyPlaces(gps, radiusMeters);
          llmFallbackTaskRef.current = task;
          try {
            const names = await task.promise;
            if (cancelled) return;
            if (__DEV__) {
              // eslint-disable-next-line no-console
              console.log(`[NearbyPois] llm fallback returned ${names.length} names (attempt ${attempt})`);
            }
            if (names.length > 0) {
              candidateNames = names;
              break;
            }
          } catch (err) {
            if (__DEV__) {
              // eslint-disable-next-line no-console
              console.warn(`[NearbyPois] llm fallback error (attempt ${attempt}): ${(err as Error)?.message ?? err}`);
            }
            break;
          }
          attempt += 1;
        }
        if (cancelled) return;
        llmFallbackTaskRef.current = null;

        if (candidateNames.length === 0) return;

        // Self-verification step: ask the model whether each candidate is
        // actually in/near the user's location. Drops obvious out-of-region
        // hallucinations ("Mont Saint-Michel" for Palo Alto) before we ever
        // show them. Skipped when we have no place name to ground against.
        const locationLabel = gps.placeName ?? '';
        let acceptedNames = candidateNames;
        if (locationLabel) {
          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.log(
              `[NearbyPois] verify ${candidateNames.length} candidates against "${locationLabel}": ${candidateNames.join(', ')}`
            );
          }
          try {
            const verifyTask = localGuideService.verifyNearbyPlaces(candidateNames, locationLabel);
            llmFallbackTaskRef.current = verifyTask as unknown as ListPlacesTask;
            acceptedNames = await verifyTask.promise;
            llmFallbackTaskRef.current = null;
            if (cancelled) return;
            if (__DEV__) {
              // eslint-disable-next-line no-console
              console.log(
                `[NearbyPois] verify accepted ${acceptedNames.length}/${candidateNames.length}: ${acceptedNames.join(', ')}`
              );
            }
          } catch (err) {
            if (__DEV__) {
              // eslint-disable-next-line no-console
              console.warn(
                `[NearbyPois] verify error: ${(err as Error)?.message ?? err} — falling back to unverified list`
              );
            }
            // On verify failure, keep the unverified list rather than blank
            // the user. The UI warning already tells them these may be
            // hallucinated.
            llmFallbackTaskRef.current = null;
          }
        }

        const llmPois: Poi[] = acceptedNames.slice(0, llmFillCount).map((name, i) => ({
          pageId: -(Date.now() + i),
          title: name,
          latitude: gps.latitude,
          longitude: gps.longitude,
          distanceMeters: 0,
          source: 'llm' as const,
        }));

        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.log(
            `[NearbyPois] final llm fill ${llmPois.length} (cap=${llmFillCount}): ${llmPois.map((p) => p.title).join(', ')}`
          );
        }

        if (llmPois.length > 0) {
          llmCacheRef.current.set(cellKey, { at: Date.now(), pois: llmPois });
        }
        setPois(mergeUnique(sorted, llmPois));
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
  }, [gps && gps.latitude.toFixed(2), gps && gps.longitude.toFixed(2), gps?.placeName, radiusMeters, hiddenGems, offline, skipLlmFill]);

  return { pois, loading };
}
