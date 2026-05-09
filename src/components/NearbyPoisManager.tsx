// Single owner of the POI pipeline (useNearbyPois → useRankedPois →
// useWalkingDistances). Mounted once at App root; pushes the latest
// result into nearbyPoisStore so any screen can subscribe and get a
// consistent snapshot.
//
// Renders nothing.
//
// Why a component instead of a plain hook: hooks are per-mount, but we
// need a SINGLE pipeline running globally so two screens see the same
// snapshot byte-for-byte. A component mounted once at App level gives us
// that, and a singleton store gives consumers a subscription point that
// doesn't depend on React's component tree position.

import { useEffect } from 'react';
import { useLocation } from '../hooks/useLocation';
import { useAppMode } from '../hooks/useAppMode';
import { useRadiusPref } from '../hooks/useRadiusPref';
import { useNearbyPois } from '../hooks/useNearbyPois';
import { useRankedPois } from '../hooks/useRankedPois';
import { useWalkingDistances } from '../hooks/useWalkingDistances';
import { guidePrefs } from '../services/GuidePrefs';
import { useState } from 'react';
import { nearbyPoisStore } from '../services/NearbyPoisStore';

export function NearbyPoisManager(): null {
  const { gps } = useLocation();
  const { effective } = useAppMode();
  const { radiusMeters } = useRadiusPref();
  const offline = effective === 'offline';

  const [hiddenGems, setHiddenGems] = useState<boolean>(guidePrefs.get().hiddenGems);
  useEffect(() => guidePrefs.subscribe((p) => setHiddenGems(p.hiddenGems)), []);

  // Pipeline — same chain both screens used to run independently. LLM fill is
  // ON when offline (no Wikipedia available) and OFF when online.
  const { pois: rawPois, loading: poisLoading } = useNearbyPois(gps, radiusMeters, {
    hiddenGems,
    offline,
    skipLlmFill: !offline,
  });

  const { ranked, loading: rankLoading } = useRankedPois(rawPois, gps, {
    hiddenGems,
    offline,
    radiusMeters,
  });

  const { enriched } = useWalkingDistances(ranked, gps);

  useEffect(() => {
    nearbyPoisStore.set({
      pois: enriched,
      loading: poisLoading || rankLoading,
    });
  }, [enriched, poisLoading, rankLoading]);

  return null;
}
