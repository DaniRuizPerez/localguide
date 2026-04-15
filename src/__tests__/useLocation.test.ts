import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useLocation } from '../hooks/useLocation';

const mockRequestForegroundPermissionsAsync = jest.fn();
const mockGetCurrentPositionAsync = jest.fn();

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: (...args: unknown[]) =>
    mockRequestForegroundPermissionsAsync(...args),
  getCurrentPositionAsync: (...args: unknown[]) => mockGetCurrentPositionAsync(...args),
}));

describe('useLocation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('transitions to ready with GPS coords on success', async () => {
    mockRequestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockGetCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 48.8566, longitude: 2.3522, accuracy: 15 },
    });

    const { result } = renderHook(() => useLocation());

    expect(result.current.status).toBe('requesting');

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.gps).toEqual({ latitude: 48.8566, longitude: 2.3522, accuracy: 15 });
    expect(result.current.errorMessage).toBeNull();
  });

  it('transitions to denied when permission not granted', async () => {
    mockRequestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });

    const { result } = renderHook(() => useLocation());

    await waitFor(() => expect(result.current.status).toBe('denied'));
    expect(result.current.gps).toBeNull();
    expect(result.current.errorMessage).toBeTruthy();
  });

  it('transitions to error when location fetch fails', async () => {
    mockRequestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockGetCurrentPositionAsync.mockRejectedValue(new Error('Location timeout'));

    const { result } = renderHook(() => useLocation());

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorMessage).toBe('Location timeout');
    expect(result.current.gps).toBeNull();
  });

  it('refresh re-fetches location', async () => {
    mockRequestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockGetCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 51.5074, longitude: -0.1278, accuracy: 20 },
    });

    const { result } = renderHook(() => useLocation());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    mockGetCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 51.51, longitude: -0.13, accuracy: 10 },
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.gps?.latitude).toBeCloseTo(51.51);
  });

  it('handles null accuracy gracefully', async () => {
    mockRequestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockGetCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 35.6762, longitude: 139.6503, accuracy: null },
    });

    const { result } = renderHook(() => useLocation());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.gps?.accuracy).toBeUndefined();
  });
});
