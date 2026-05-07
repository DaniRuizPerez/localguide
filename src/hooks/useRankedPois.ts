import { useEffect, useMemo, useState } from 'react';
import type { Poi } from '../services/PoiService';
import type { GPSContext } from '../services/InferenceService';
import {
  rankByInterestSync,
  rankByInterestOffline,
  rankByInterestOnline,
} from '../services/poiRanking';
import { wikipediaSignals } from '../services/wikipediaSignals';

export interface UseRankedPoisOptions {
  hiddenGems: boolean;
  offline: boolean; // effective mode === 'offline'
  radiusMeters: number;
}

export interface UseRankedPoisResult {
  ranked: Poi[];
  loading: boolean; // true while async re-rank is in flight
}

/**
 * Two-stage POI ranking hook extracted from ChatScreen.
 *
 * Stage 1 (sync, fast): paints immediately with a distance-decay ranker so the
 * user sees results within ~500 ms of GPS lock.
 *
 * Stage 2 (async, online only): fetches Wikipedia signals (categories,
 * pageviews, langlinks) and re-ranks with the composite ranker once they land
 * (typically 600–1500 ms later). `loading` is true while the fetch is in
 * flight; the sync ranking is shown in the meantime.
 *
 * Offline mode skips the async stage entirely — GeoNames feature-code ranker,
 * no network, single paint.
 *
 * Mirrors the inline logic in ChatScreen.tsx:147–200 bug-for-bug so that
 * Agent C can drop-swap ChatScreen to use this hook without changing behaviour.
 */
export function useRankedPois(
  pois: Poi[],
  gps: GPSContext | null,
  opts: UseRankedPoisOptions
): UseRankedPoisResult {
  const { hiddenGems, offline, radiusMeters } = opts;

  // Stage 1 — sync first paint.
  // gps is intentionally split into primitive deps because the location hook
  // returns a fresh object reference on each render even when the underlying
  // lat/lon haven't moved — depending on the object directly would re-paint
  // endlessly. eslint-disable-next-line is honest about it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const syncRanked = useMemo(
    () =>
      offline
        ? rankByInterestOffline(pois, gps, { hiddenGems, radiusMeters })
        : rankByInterestSync(pois, gps, { hiddenGems, radiusMeters }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pois, gps?.latitude, gps?.longitude, hiddenGems, offline, radiusMeters]
  );

  // Stage 2 — async re-rank (online only).
  const [refinedPois, setRefinedPois] = useState<Poi[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Reset on dep change so the sync sort shows while the new fetch runs.
    setRefinedPois(null);

    if (offline || pois.length === 0) {
      setLoading(false);
      return;
    }

    const wikiPageIds = pois
      .filter((p) => p.source === 'wikipedia')
      .map((p) => p.pageId);

    if (wikiPageIds.length === 0) {
      setLoading(false);
      return;
    }

    setLoading(true);

    const ctrl = new AbortController();
    let cancelled = false;

    wikipediaSignals
      .fetchBatch(wikiPageIds, ctrl.signal)
      .then((signals) => {
        if (cancelled) return;
        if (signals.size === 0) {
          // No signals returned — keep the sync paint, but clear the loading flag.
          setLoading(false);
          return;
        }
        const refined = rankByInterestOnline(pois, gps, signals, {
          hiddenGems,
          radiusMeters,
        });
        setRefinedPois(refined);
        setLoading(false);
      })
      .catch(() => {
        // Network failure — keep the sync paint.
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pois, gps?.latitude, gps?.longitude, hiddenGems, offline, radiusMeters]);

  return {
    ranked: refinedPois ?? syncRanked,
    loading,
  };
}
