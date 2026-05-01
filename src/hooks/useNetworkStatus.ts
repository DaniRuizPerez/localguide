import { useEffect, useState } from 'react';
import { networkStatus, type NetworkState } from '../services/NetworkStatus';

// Returns the live network state. Subscribes for updates so the component
// re-renders on transitions (online ↔ offline ↔ unknown).
export function useNetworkStatus(): NetworkState {
  const [state, setState] = useState<NetworkState>(() => networkStatus.get());

  useEffect(() => {
    setState(networkStatus.get());
    return networkStatus.subscribe(setState);
  }, []);

  return state;
}
