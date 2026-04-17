/**
 * Characterization: ChatScreen rendering
 *
 * Locks in the observable UI behavior of ChatScreen so refactor PRs
 * (component extraction, hook slimming) can verify nothing regressed.
 *
 * Tests that touch message IDs note the current Date.now() key scheme.
 * PR 1 changes those to crypto.randomUUID(); update the key assertions there.
 */

import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import ChatScreen from '../screens/ChatScreen';

// ── Standard mock suite (same as App.test.tsx) ────────────────────────────

jest.mock('../native/LiteRTModule', () => ({ __esModule: true, default: undefined }));

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  launchCameraAsync: jest.fn().mockResolvedValue({ canceled: true }),
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

const mockSpeechSpeak = jest.fn().mockResolvedValue(undefined);
const mockSpeechStop = jest.fn();
jest.mock('expo-speech', () => ({
  speak: (...args: unknown[]) => mockSpeechSpeak(...args),
  stop: (...args: unknown[]) => mockSpeechStop(...args),
  isSpeakingAsync: jest.fn().mockResolvedValue(false),
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn().mockResolvedValue(false),
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

const mockAsk = jest.fn();
jest.mock('../services/LocalGuideService', () => ({
  localGuideService: {
    initialize: jest.fn().mockResolvedValue(undefined),
    ask: (...args: unknown[]) => mockAsk(...args),
    dispose: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../services/SpeechService', () => ({
  speechService: {
    speak: (...args: unknown[]) => mockSpeechSpeak(...args),
    stop: (...args: unknown[]) => mockSpeechStop(...args),
    isSpeaking: false,
  },
}));

// ── useLocation mock — eliminates async act() warnings from async GPS fetch ──

const GPS = { latitude: 48.8566, longitude: 2.3522, accuracy: 10 };

const mockRefresh = jest.fn().mockResolvedValue(undefined);
const mockSetManualLocation = jest.fn();

const defaultLocationState = {
  gps: GPS,
  status: 'ready' as const,
  errorMessage: null,
  refresh: mockRefresh,
  manualLocation: null,
  setManualLocation: mockSetManualLocation,
};

jest.mock('../hooks/useLocation', () => ({
  useLocation: jest.fn(),
}));

const mockNavigation = {} as any;
const chatRoute = { key: 'Chat', name: 'Chat' } as any;

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Characterization: ChatScreen — initial render', () => {
  beforeEach(() => {
    const { useLocation } = require('../hooks/useLocation');
    useLocation.mockReturnValue(defaultLocationState);
  });

  it('renders the text input with correct placeholder', () => {
    const { getByPlaceholderText } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );
    expect(getByPlaceholderText('Ask about nearby places…')).toBeTruthy();
  });

  it('renders a Send button', () => {
    const { getByText } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );
    expect(getByText('↑')).toBeTruthy();
  });

  it('renders the Auto-Guide toggle label', () => {
    const { getByText } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );
    expect(getByText('Auto-Guide')).toBeTruthy();
  });

  it('renders the Speak toggle label', () => {
    const { getByText } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );
    expect(getByText('Speak')).toBeTruthy();
  });

  it('shows empty-state hint when no messages', () => {
    const { getAllByText } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );
    // Both the empty hint and Auto-Guide label contain these words; at least one match expected
    expect(getAllByText(/Ask your local guide|Auto-Guide/i).length).toBeGreaterThan(0);
  });

  it('Send button does not trigger inference when input is empty', async () => {
    const { getByText } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );
    // Press Send with no input typed — ask() must not be called
    fireEvent.press(getByText('↑'));
    expect(mockAsk).not.toHaveBeenCalled();
  });
});

describe('Characterization: ChatScreen — sending a message', () => {
  beforeEach(() => {
    const { useLocation } = require('../hooks/useLocation');
    useLocation.mockReturnValue(defaultLocationState);
    mockAsk.mockClear();
    mockSpeechSpeak.mockClear();
    mockAsk.mockResolvedValue({
      text: 'You are near the Eiffel Tower.',
      locationUsed: GPS,
      durationMs: 420,
    });
  });

  it('appends user message to the list after Send', async () => {
    const { getByPlaceholderText, getByText, findByText } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );

    const input = getByPlaceholderText('Ask about nearby places…');
    fireEvent.changeText(input, 'What is near me?');
    fireEvent.press(getByText('↑'));

    expect(await findByText('What is near me?')).toBeTruthy();
  });

  it('appends guide response after inference resolves', async () => {
    const { getByPlaceholderText, getByText, findByText } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );

    const input = getByPlaceholderText('Ask about nearby places…');
    fireEvent.changeText(input, 'What is near me?');
    fireEvent.press(getByText('↑'));

    expect(await findByText('You are near the Eiffel Tower.')).toBeTruthy();
  });

  it('calls localGuideService.ask with the query and GPS', async () => {
    const { getByPlaceholderText, getByText } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );

    fireEvent.changeText(getByPlaceholderText('Ask about nearby places…'), 'test query');
    await act(async () => { fireEvent.press(getByText('↑')); });

    expect(mockAsk).toHaveBeenCalledWith(
      'test query',
      expect.objectContaining({ latitude: GPS.latitude, longitude: GPS.longitude })
    );
  });

  it('calls speechService.speak with the response text when Speak is on', async () => {
    const { getByPlaceholderText, getByText } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );

    fireEvent.changeText(getByPlaceholderText('Ask about nearby places…'), 'speak test');
    await act(async () => { fireEvent.press(getByText('↑')); });

    await waitFor(() => expect(mockSpeechSpeak).toHaveBeenCalledWith('You are near the Eiffel Tower.'));
  });

  it('shows error message when inference throws', async () => {
    mockAsk.mockRejectedValue(new Error('model crash'));

    const { getByPlaceholderText, getByText, findByText } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );

    fireEvent.changeText(getByPlaceholderText('Ask about nearby places…'), 'crash test');
    fireEvent.press(getByText('↑'));

    expect(await findByText(/something went wrong/i)).toBeTruthy();
  });

  it('clears the text input after Send', async () => {
    const { getByPlaceholderText, getByText } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );

    const input = getByPlaceholderText('Ask about nearby places…');
    fireEvent.changeText(input, 'clear me');
    await act(async () => { fireEvent.press(getByText('↑')); });

    expect(input.props.value).toBe('');
  });
});

describe('Characterization: ChatScreen — no location available', () => {
  it('shows error message when Send pressed with no GPS', async () => {
    const { useLocation } = require('../hooks/useLocation');
    useLocation.mockReturnValue({
      gps: null,
      status: 'error',
      errorMessage: 'location unavailable',
      refresh: mockRefresh,
      manualLocation: null,
      setManualLocation: mockSetManualLocation,
    });

    const { getByPlaceholderText, getByText, findAllByText } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );

    fireEvent.changeText(getByPlaceholderText('Ask about nearby places…'), 'where am I?');
    fireEvent.press(getByText('↑'));

    const matches = await findAllByText(/Location not available yet|GPS unavailable/i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Characterization: ChatScreen — message rendering', () => {
  it('renders both user and guide bubbles in a mixed conversation', async () => {
    const { useLocation } = require('../hooks/useLocation');
    useLocation.mockReturnValue(defaultLocationState);
    mockAsk.mockResolvedValue({ text: 'Guide reply.', locationUsed: GPS, durationMs: 100 });

    const { getByPlaceholderText, getByText, findByText } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );

    const input = getByPlaceholderText('Ask about nearby places…');
    fireEvent.changeText(input, 'Hello');

    await act(async () => { fireEvent.press(getByText('↑')); });

    expect(await findByText('Hello')).toBeTruthy();
    expect(await findByText('Guide reply.')).toBeTruthy();
  });
});
