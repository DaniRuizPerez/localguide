import { renderHook, act } from '@testing-library/react-native';
import { radiusPrefs } from '../services/RadiusPrefs';
import { useRadiusPref } from '../hooks/useRadiusPref';

beforeEach(() => {
  radiusPrefs.__resetForTest();
});

describe('useRadiusPref', () => {
  it('returns default radiusMeters of 10000 on initial render', () => {
    const { result } = renderHook(() => useRadiusPref());
    expect(result.current.radiusMeters).toBe(10000);
  });

  it('setRadiusMeters updates the returned state', () => {
    const { result } = renderHook(() => useRadiusPref());

    act(() => {
      result.current.setRadiusMeters(5000);
    });

    expect(result.current.radiusMeters).toBe(5000);
  });

  it('reflects changes pushed via radiusPrefs.set() directly', () => {
    const { result } = renderHook(() => useRadiusPref());

    act(() => {
      radiusPrefs.set(20000);
    });

    expect(result.current.radiusMeters).toBe(20000);
  });

  it('ignores invalid values — state stays at current value', () => {
    const { result } = renderHook(() => useRadiusPref());

    act(() => {
      result.current.setRadiusMeters(3000); // not valid
    });

    expect(result.current.radiusMeters).toBe(10000);
  });

  it('unsubscribes from radiusPrefs on unmount', () => {
    const { result, unmount } = renderHook(() => useRadiusPref());

    act(() => {
      result.current.setRadiusMeters(2000);
    });
    expect(result.current.radiusMeters).toBe(2000);

    unmount();

    // After unmount, direct store changes should not cause errors.
    act(() => {
      radiusPrefs.set(10000);
    });
    // No assertion on result (hook unmounted) — just confirming no throw.
  });
});
