import { useEffect, useState } from 'react';
import { radiusPrefs } from '../services/RadiusPrefs';

export function useRadiusPref(): {
  radiusMeters: number;
  setRadiusMeters: (m: number) => void;
} {
  const [radiusMeters, setRadiusMeters] = useState<number>(
    () => radiusPrefs.get().radiusMeters
  );

  useEffect(() => {
    // Sync with any change that happened between render and effect.
    setRadiusMeters(radiusPrefs.get().radiusMeters);
    return radiusPrefs.subscribe((state) => setRadiusMeters(state.radiusMeters));
  }, []);

  return {
    radiusMeters,
    setRadiusMeters: (m: number) => radiusPrefs.set(m),
  };
}
