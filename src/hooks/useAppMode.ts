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
    // A single appMode subscription captures both modeChoice and networkState
    // changes since appMode listens to both. Sync the rest of the triple too.
    setState(snapshot());
    return appMode.subscribe(() => setState(snapshot()));
  }, []);

  return state;
}
