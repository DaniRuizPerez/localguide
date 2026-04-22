/**
 * D1 — explicit "What is this?" camera entry point on the Chat header.
 * Verifies the button exists and launches the camera when pressed.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('../native/LiteRTModule', () => ({ __esModule: true, default: undefined }));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn().mockResolvedValue(false),
}));

const mockRequestCameraPerm = jest.fn().mockResolvedValue({ status: 'granted' });
const mockLaunchCamera = jest.fn().mockResolvedValue({ canceled: true });

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: (...args: unknown[]) => mockRequestCameraPerm(...args),
  launchCameraAsync: (...args: unknown[]) => mockLaunchCamera(...args),
  MediaTypeOptions: { Images: 'Images' },
}));

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

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue({
    coords: { latitude: 48.8566, longitude: 2.3522, accuracy: 10 },
  }),
  requestBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
  startLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
  stopLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/LocalGuideService', () => ({
  localGuideService: {
    initialize: jest.fn().mockResolvedValue(undefined),
    ask: jest.fn(),
    askStream: jest.fn().mockResolvedValue({ abort: jest.fn() }),
    askWithImageStream: jest.fn().mockResolvedValue({ abort: jest.fn() }),
    listNearbyPlaces: jest.fn(() => ({
      promise: new Promise<string[]>(() => {}),
      abort: jest.fn().mockResolvedValue(undefined),
    })),
    dispose: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../services/SpeechService', () => ({
  speechService: {
    speak: jest.fn(),
    enqueue: jest.fn(),
    stop: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    skipCurrent: jest.fn(),
    isSpeaking: false,
    isPaused: false,
    queueLength: 0,
    getState: () => ({ isSpeaking: false, isPaused: false, queueLength: 0 }),
    subscribe: () => () => {},
  },
}));

const GPS = { latitude: 48.8566, longitude: 2.3522, accuracy: 10 };
const defaultLocationState = {
  gps: GPS,
  status: 'ready' as const,
  errorMessage: null,
  refresh: jest.fn().mockResolvedValue(undefined),
  manualLocation: null,
  setManualLocation: jest.fn(),
};

jest.mock('../hooks/useLocation', () => ({
  useLocation: jest.fn(),
}));

import ChatScreen from '../screens/ChatScreen';

describe('ChatScreen D1 — identify-this camera entry', () => {
  // After the Option-A Chat IA redesign, the labeled "What is this?" button
  // moved out of the header. The camera action now lives only inside the
  // input capsule (testID "camera-btn") — same functionality, less clutter.
  beforeEach(() => {
    const { useLocation } = require('../hooks/useLocation');
    useLocation.mockReturnValue(defaultLocationState);
    mockRequestCameraPerm.mockClear();
    mockLaunchCamera.mockClear();
  });

  it('renders a camera button inside the input capsule', () => {
    const { getByTestId } = render(
      <ChatScreen navigation={{} as any} route={{ key: 'Chat', name: 'Chat' } as any} />
    );
    expect(getByTestId('camera-btn')).toBeTruthy();
  });

  it('opens the camera when pressed', async () => {
    const { getByTestId } = render(
      <ChatScreen navigation={{} as any} route={{ key: 'Chat', name: 'Chat' } as any} />
    );
    await act(async () => {
      fireEvent.press(getByTestId('camera-btn'));
    });
    expect(mockRequestCameraPerm).toHaveBeenCalled();
    expect(mockLaunchCamera).toHaveBeenCalled();
  });
});
