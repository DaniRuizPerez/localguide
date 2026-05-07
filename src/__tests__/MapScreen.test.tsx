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
// MapScreen now uses useNearbyPois which calls fetchNearbyStreaming (not fetchNearby).
const mockFetchNearbyStreaming = jest.fn();
jest.mock('../services/PoiService', () => ({
  poiService: {
    fetchNearby: jest.fn().mockResolvedValue([]),
    fetchNearbyStreaming: (...args: unknown[]) => mockFetchNearbyStreaming(...args),
    clearCache: jest.fn(),
  },
  distanceMeters: jest.fn().mockReturnValue(300),
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
    mockFetchNearbyStreaming.mockResolvedValue([onlinePoi]);
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

  // The core regression guard: verify the offline flag is passed correctly to
  // fetchNearbyStreaming (used by useNearbyPois). MapScreen now delegates POI
  // fetching to useNearbyPois + useRankedPois instead of calling fetchNearby
  // directly, so these tests assert against fetchNearbyStreaming.

  it('online mode: fetches POIs with offline=false via useNearbyPois', async () => {
    mockEffective = 'online';
    mockFetchNearbyStreaming.mockResolvedValue([onlinePoi]);

    render(<MapScreen navigation={mockNavigation} route={mockRoute} />);

    await waitFor(() => {
      expect(mockFetchNearbyStreaming).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        expect.any(Number), // radiusMeters from useRadiusPref (default 5000)
        500,               // wide candidate pool
        expect.objectContaining({ offline: false }),
        expect.any(Object)  // streaming callbacks
      );
    });
  });

  // Regression for A10: offline mode previously short-circuited to setPois([])
  // and rendered an empty map. Now it delegates to fetchNearbyStreaming({ offline: true })
  // which returns GeoNames hits with real coords.
  it('offline mode: fetches POIs with offline=true (GeoNames path)', async () => {
    mockEffective = 'offline';
    mockFetchNearbyStreaming.mockResolvedValue([offlinePoi]);

    render(<MapScreen navigation={mockNavigation} route={mockRoute} />);

    await waitFor(() => {
      expect(mockFetchNearbyStreaming).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        expect.any(Number), // radiusMeters from useRadiusPref (default 5000)
        500,               // wide candidate pool
        expect.objectContaining({ offline: true }),
        expect.any(Object)  // streaming callbacks
      );
    });
  });

  it('offline mode with empty GeoNames response: still fetches with offline=true', async () => {
    mockEffective = 'offline';
    mockFetchNearbyStreaming.mockResolvedValue([]);

    render(<MapScreen navigation={mockNavigation} route={mockRoute} />);

    await waitFor(() => {
      expect(mockFetchNearbyStreaming).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        500,
        expect.objectContaining({ offline: true }),
        expect.any(Object)
      );
    });
  });
});
