// Shared singleton holding the latest "Around You" POI snapshot. Both
// ChatScreen's HomeState and MapScreen's bottom-sheet rows subscribe to
// this so they show identical lists at all times — same identity, same
// length, same order, same walking distances.
//
// Without this, each screen called useNearbyPois → useRankedPois →
// useWalkingDistances independently. Because useLocation subscribes
// per-mount and useNearbyPois has a grid-cell cache keyed on toFixed(2)
// coordinates, the two screens could land on different cache cells
// during GPS jitter, producing visibly different lists. (And ChatScreen
// applies filterPoisByTopics upstream, which made the divergence more
// pronounced when the user picked a non-default topic.)
//
// Pattern mirrors RadiusPrefs / GuidePrefs — pub/sub, no AsyncStorage
// (this is session-only data).

import type { Poi } from './PoiService';

export interface NearbyPoisSnapshot {
  pois: Poi[];
  loading: boolean;
}

const EMPTY_SNAPSHOT: NearbyPoisSnapshot = { pois: [], loading: false };

let snap: NearbyPoisSnapshot = EMPTY_SNAPSHOT;
const subscribers = new Set<(s: NearbyPoisSnapshot) => void>();

function notify(): void {
  for (const cb of subscribers) cb(snap);
}

export const nearbyPoisStore = {
  get(): NearbyPoisSnapshot {
    return snap;
  },

  /** Called by NearbyPoisManager — publishes the latest pipeline result. */
  set(next: NearbyPoisSnapshot): void {
    if (next === snap) return;
    snap = next;
    notify();
  },

  subscribe(cb: (s: NearbyPoisSnapshot) => void): () => void {
    subscribers.add(cb);
    return () => {
      subscribers.delete(cb);
    };
  },
};
