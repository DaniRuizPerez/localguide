import React from 'react';
import { render } from '@testing-library/react-native';
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
  it('renders without crashing', () => {
    const { toJSON } = render(
      <MapScreen navigation={mockNavigation} route={mockRoute} />
    );
    expect(toJSON()).toBeTruthy();
  });

  it('shows loading state initially', () => {
    const { getByText } = render(
      <MapScreen navigation={mockNavigation} route={mockRoute} />
    );
    expect(getByText(/Getting your location/i)).toBeTruthy();
  });
});
