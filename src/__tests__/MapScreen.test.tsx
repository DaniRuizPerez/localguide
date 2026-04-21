import React from 'react';
import { render, waitFor, act } from '@testing-library/react-native';

// react-native-maps calls TurboModuleRegistry.getEnforcing('RNMapsAirModule') at
// import time, which explodes in Jest. Stub the surface we actually use.
jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MapView = React.forwardRef(function MapView(
    props: Record<string, unknown>,
    _ref: unknown
  ) {
    return React.createElement(View, { testID: 'map-view', ...props });
  });
  const Marker = (props: Record<string, unknown>) =>
    React.createElement(View, { testID: 'map-marker', ...props });
  const Polyline = (props: Record<string, unknown>) =>
    React.createElement(View, { testID: 'map-polyline', ...props });
  return {
    __esModule: true,
    default: MapView,
    Marker,
    Polyline,
    PROVIDER_GOOGLE: 'google',
  };
});

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
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders without crashing', async () => {
    const { toJSON } = render(
      <MapScreen navigation={mockNavigation} route={mockRoute} />
    );
    expect(toJSON()).toBeTruthy();
    // Flush all async effects to avoid act() warnings
    await act(async () => {});
  });

  it('calls location APIs on mount', async () => {
    render(<MapScreen navigation={mockNavigation} route={mockRoute} />);
    await waitFor(() => {
      expect(mockRequestForegroundPermissionsAsync).toHaveBeenCalled();
      expect(mockGetCurrentPositionAsync).toHaveBeenCalled();
    });
  });

  it('shows loading state while requesting location', async () => {
    // Keep permissions pending so we can observe the requesting state
    let resolvePermission: (val: unknown) => void;
    mockRequestForegroundPermissionsAsync.mockReturnValueOnce(
      new Promise((resolve) => { resolvePermission = resolve; })
    );

    const { getByText } = render(
      <MapScreen navigation={mockNavigation} route={mockRoute} />
    );

    await waitFor(() => {
      expect(getByText(/Getting your location/i)).toBeTruthy();
    });

    // Clean up: resolve the permission to avoid open handles
    resolvePermission!({ status: 'granted' });
    await act(async () => {});
  });
});
