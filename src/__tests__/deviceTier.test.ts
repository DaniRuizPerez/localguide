import { featuresForTier, type DeviceTier } from '../services/deviceTier';

describe('featuresForTier', () => {
  it('low tier has no multimodal, no background inference, is slow', () => {
    expect(featuresForTier('low')).toEqual({
      multimodal: false,
      slowInference: true,
      backgroundInference: false,
    });
  });

  it('mid tier has multimodal but no background inference, not slow', () => {
    expect(featuresForTier('mid')).toEqual({
      multimodal: true,
      slowInference: false,
      backgroundInference: false,
    });
  });

  it('high tier has everything', () => {
    expect(featuresForTier('high')).toEqual({
      multimodal: true,
      slowInference: false,
      backgroundInference: true,
    });
  });

  it('is a pure function (same tier → same flags across calls)', () => {
    const tiers: DeviceTier[] = ['low', 'mid', 'high'];
    for (const t of tiers) {
      expect(featuresForTier(t)).toEqual(featuresForTier(t));
    }
  });
});
