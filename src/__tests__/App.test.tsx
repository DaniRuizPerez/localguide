import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('../native/LiteRTModule', () => ({ __esModule: true, default: undefined }));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn().mockResolvedValue(false),
}));

import ChatScreen from '../screens/ChatScreen';
import MapScreen from '../screens/MapScreen';

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

  it('renders the Home greeting on empty state', () => {
    // The Home state shows a location headline ("You're in …" or
    // "You're here.") + the "Want to wander?" prompt when there are no
    // messages yet.
    const { getByText } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );
    expect(getByText(/You're (in|here)/i)).toBeTruthy();
    expect(getByText(/Want to wander\?/)).toBeTruthy();
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
