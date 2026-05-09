// Subscribe to the shared nearbyPoisStore so both ChatScreen's HomeState
// and MapScreen's bottom-sheet rows render the same list at all times.
//
// The pipeline (useNearbyPois → useRankedPois → useWalkingDistances) is
// owned by NearbyPoisManager mounted at App root.

import { useEffect, useState } from 'react';
import { nearbyPoisStore, type NearbyPoisSnapshot } from '../services/NearbyPoisStore';

export function useVisiblePois(): NearbyPoisSnapshot {
  const [snap, setSnap] = useState<NearbyPoisSnapshot>(() => nearbyPoisStore.get());

  useEffect(() => {
    return nearbyPoisStore.subscribe(setSnap);
  }, []);

  return snap;
}
