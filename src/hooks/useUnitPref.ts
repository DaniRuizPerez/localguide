import { useEffect, useState } from 'react';
import { unitPrefs } from '../services/UnitPrefs';

export function useUnitPref(): {
  units: 'km' | 'miles';
  setUnits: (u: 'km' | 'miles') => void;
} {
  const [units, setUnits] = useState<'km' | 'miles'>(
    () => unitPrefs.get().units
  );

  useEffect(() => {
    // Sync with any change that happened between render and effect.
    setUnits(unitPrefs.get().units);
    return unitPrefs.subscribe((state) => setUnits(state.units));
  }, []);

  return {
    units,
    setUnits: (u: 'km' | 'miles') => unitPrefs.set(u),
  };
}
