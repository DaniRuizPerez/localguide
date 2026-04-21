import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// Stub react-native-maps before MapScreen is imported — the real module calls
// TurboModuleRegistry.getEnforcing('RNMapsAirModule'), which doesn't exist in Jest.
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

import ChatScreen from '../screens/ChatScreen';
import MapScreen from '../screens/MapScreen';

jest.mock('../native/LiteRTModule', () => ({ __esModule: true, default: undefined }));

jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
    getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
    start: jest.fn(),
    stop: jest.fn(),
    abort: jest.fn(),
  },
  useSpeechRecognitionEvent: jest.fn(),
}));

jest.mock('expo-speech', () => ({
  speak: jest.fn(),
  stop: jest.fn(),
  isSpeakingAsync: jest.fn().mockResolvedValue(false),
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn().mockResolvedValue(false),
}));

const mockRequestForegroundPermissionsAsync = jest.fn().mockResolvedValue({ status: 'granted' });
const mockGetCurrentPositionAsync = jest.fn().mockResolvedValue({
  coords: { latitude: 48.8566, longitude: 2.3522, accuracy: 10 },
});

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: (...args: unknown[]) =>
    mockRequestForegroundPermissionsAsync(...args),
  getCurrentPositionAsync: (...args: unknown[]) => mockGetCurrentPositionAsync(...args),
}));

const mockNavigation = {} as any;
const chatRoute = { key: 'Chat', name: 'Chat' } as any;
const mapRoute = { key: 'Map', name: 'Map' } as any;

describe('ChatScreen', () => {
  it('renders input and send button', () => {
    const { getByPlaceholderText, getByText } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );
    expect(getByPlaceholderText("Ask about what's near you…")).toBeTruthy();
    expect(getByText('↑')).toBeTruthy();
  });

  it('renders empty state hint', () => {
    const { getAllByText } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );
    expect(getAllByText(/local guide|Auto-Guide/i).length).toBeGreaterThan(0);
  });
});

describe('MapScreen', () => {
  it('renders without crashing', () => {
    const { toJSON } = render(
      <MapScreen navigation={mockNavigation} route={mapRoute} />
    );
    expect(toJSON()).toBeTruthy();
  });
});
