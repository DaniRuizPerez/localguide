export type DeviceTier = 'low' | 'mid' | 'high';

/**
 * Per-tier feature capability flags. When a tier lacks a capability, the
 * consumer should skip / hide the corresponding feature rather than letting
 * it silently fail on-device.
 *
 * Keep this list synchronized with the native tier classifier in
 * LiteRTModule. Current rules:
 *   - multimodal (Gemma 4 E2B): only mid/high devices (4 GB+ RAM).
 *   - slowInference: low-tier devices run Gemma on CPU and can take
 *     10–20 seconds for a paragraph of narration.
 *   - backgroundInference: high-tier only. Mid-tier is borderline —
 *     battery cost outweighs the UX win.
 */
export interface FeatureFlags {
  multimodal: boolean;
  slowInference: boolean;
  backgroundInference: boolean;
}

/**
 * Derive the feature flags for a tier synchronously. Pure function — safe to
 * call from both React hooks and other services (e.g. ModelDownloadService
 * uses it to pick the right model profile).
 */
export function featuresForTier(tier: DeviceTier): FeatureFlags {
  return {
    multimodal: tier !== 'low',
    slowInference: tier === 'low',
    backgroundInference: tier === 'high',
  };
}
