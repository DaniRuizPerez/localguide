import { useEffect, useState } from 'react';
import { breadcrumbTrail, type BreadcrumbPoint } from '../services/BreadcrumbTrail';

// React glue for the BreadcrumbTrail service. Returns the current array of
// points and subscribes to updates. Hydration runs once; subsequent calls
// piggy-back on the cached state.
export function useBreadcrumbTrail(): BreadcrumbPoint[] {
  const [points, setPoints] = useState<BreadcrumbPoint[]>(() => breadcrumbTrail.getPoints());

  useEffect(() => {
    breadcrumbTrail.hydrate().then(() => setPoints(breadcrumbTrail.getPoints()));
    return breadcrumbTrail.subscribe(setPoints);
  }, []);

  return points;
}
