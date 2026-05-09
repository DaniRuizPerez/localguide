import { useEffect, useState } from 'react';
import { appMode, type EffectiveMode } from '../services/AppMode';
import { guidePrefs, type ModeChoice } from '../services/GuidePrefs';
import { networkStatus, type NetworkState } from '../services/NetworkStatus';

interface AppModeState {
  choice: ModeChoice;
  effective: EffectiveMode;
  networkState: NetworkState;
}

function snapshot(): AppModeState {
  return {
    choice: guidePrefs.get().modeChoice,
    effective: appMode.get(),
    networkState: networkStatus.get(),
  };
}

// Returns the current mode triple: user's choice, resolved effective mode,
// and the raw network state. Re-renders on any of the three changing.
export function useAppMode(): AppModeState {
  const [state, setState] = useState<AppModeState>(snapshot);

  useEffect(() => {
    // Subscribe to all three sources independently. appMode.subscribe alone
    // is not enough because it only notifies when `effective` flips — a raw
    // network transition (unknown → online) with effective unchanged would
    // not propagate, leaving the ConnectionPill stuck in its "probing"
    // appearance.
    setState(snapshot());
    const resync = () => setState(snapshot());
    const unsubMode = appMode.subscribe(resync);
    const unsubNet = networkStatus.subscribe(resync);
    const unsubPrefs = guidePrefs.subscribe(resync);
    return () => {
      unsubMode();
      unsubNet();
      unsubPrefs();
    };
  }, []);

  return state;
}
