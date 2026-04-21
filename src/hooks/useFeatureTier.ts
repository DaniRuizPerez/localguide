import { useEffect, useState } from 'react';
import { inferenceService } from '../services/InferenceService';
import { featuresForTier, type DeviceTier, type FeatureFlags } from '../services/deviceTier';

export type { DeviceTier, FeatureFlags } from '../services/deviceTier';
export { featuresForTier } from '../services/deviceTier';

interface TierState {
  tier: DeviceTier | null;
  features: FeatureFlags | null;
}

/**
 * Fetch the device tier once on mount and expose flags. Returns
 * { tier: null, features: null } until the native classifier replies,
 * so consumers should guard optional chaining (e.g. `features?.multimodal`).
 *
 * The classifier caches in native code, so repeated invocations are cheap.
 */
export function useFeatureTier(): TierState {
  const [tier, setTier] = useState<DeviceTier | null>(null);

  useEffect(() => {
    let cancelled = false;
    inferenceService.getDeviceTier().then((info) => {
      if (cancelled || !info) return;
      setTier(info.tier);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    tier,
    features: tier ? featuresForTier(tier) : null,
  };
}
