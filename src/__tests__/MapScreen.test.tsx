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

// Control effective mode per-test so we can exercise the online/offline paths
// without wiring the full AppMode/NetworkStatus/GuidePrefs singleton graph.
let mockEffective: 'online' | 'offline' = 'online';
jest.mock('../hooks/useAppMode', () => ({
  useAppMode: () => ({
    choice: 'auto',
    effective: mockEffective,
    networkState: mockEffective === 'offline' ? 'offline' : 'online',
  }),
}));

// Intercept POI fetches so tests are deterministic and don't hit the network.
const mockFetchNearby = jest.fn();
jest.mock('../services/PoiService', () => ({
  poiService: {
    fetchNearby: (...args: unknown[]) => mockFetchNearby(...args),
    fetchNearbyStreaming: jest.fn().mockResolvedValue([]),
    clearCache: jest.fn(),
  },
}));

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

const onlinePoi = {
  pageId: 1,
  title: 'Big Ben',
  latitude: 51.5007,
  longitude: -0.1246,
  distanceMeters: 300,
  source: 'wikipedia' as const,
};

const offlinePoi = {
  pageId: 2001,
  title: 'Hyde Park',
  latitude: 51.5073,
  longitude: -0.1657,
  distanceMeters: 850,
  source: 'geonames' as const,
  featureCode: 'PRK',
};

describe('MapScreen', () => {
  beforeEach(() => {
    mockEffective = 'online';
    mockFetchNearby.mockResolvedValue([onlinePoi]);
  });

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

  // The core regression guard: verify the offline flag is passed correctly.
  // Marker rendering is not assertable here since MapView falls back to the
  // "Map unavailable" view when EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is unset in CI.
  // The fetchNearby call-arg assertions are what matter for A10.

  it('online mode: calls fetchNearby with offline=false', async () => {
    mockEffective = 'online';
    mockFetchNearby.mockResolvedValue([onlinePoi]);

    render(<MapScreen navigation={mockNavigation} route={mockRoute} />);

    await waitFor(() => {
      expect(mockFetchNearby).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        2000,
        6,
        { offline: false }
      );
    });
  });

  // Regression for A10: offline mode previously short-circuited to setPois([])
  // and rendered an empty map. Now it delegates to fetchNearby({ offline: true })
  // which returns GeoNames hits with real coords.
  it('offline mode: calls fetchNearby with offline=true (GeoNames path)', async () => {
    mockEffective = 'offline';
    mockFetchNearby.mockResolvedValue([offlinePoi]);

    render(<MapScreen navigation={mockNavigation} route={mockRoute} />);

    await waitFor(() => {
      expect(mockFetchNearby).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        2000,
        6,
        { offline: true }
      );
    });
  });

  it('offline mode with empty GeoNames response: still calls fetchNearby with offline=true', async () => {
    mockEffective = 'offline';
    mockFetchNearby.mockResolvedValue([]);

    render(<MapScreen navigation={mockNavigation} route={mockRoute} />);

    await waitFor(() => {
      expect(mockFetchNearby).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        2000,
        6,
        { offline: true }
      );
    });
  });
});
