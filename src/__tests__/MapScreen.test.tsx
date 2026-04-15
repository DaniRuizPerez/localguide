import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import MapScreen from '../screens/MapScreen';

const mockRequestForegroundPermissionsAsync = jest.fn().mockResolvedValue({ status: 'granted' });
const mockGetCurrentPositionAsync = jest.fn().mockResolvedValue({
  coords: { latitude: 51.5074, longitude: -0.1278, accuracy: 20 },
});

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: (...args: unknown[]) =>
    mockRequestForegroundPermissionsAsync(...args),
  getCurrentPositionAsync: (...args: unknown[]) => mockGetCurrentPositionAsync(...args),
}));

const mockNavigation = {} as any;
const mockRoute = { key: 'Map', name: 'Map' } as any;

describe('MapScreen', () => {
  it('renders without crashing', async () => {
    const { toJSON } = render(
      <MapScreen navigation={mockNavigation} route={mockRoute} />
    );
    await waitFor(() => expect(toJSON()).toBeTruthy());
  });

  it('shows loading state initially', async () => {
    const { getByText, queryByText } = render(
      <MapScreen navigation={mockNavigation} route={mockRoute} />
    );
    // Loading text visible immediately after render (before async location resolves)
    expect(getByText(/Getting your location/i)).toBeTruthy();
    // Flush async state updates to avoid act() warnings
    await waitFor(() => {
      expect(queryByText(/Getting your location/i)).toBeNull();
    });
  });
});
