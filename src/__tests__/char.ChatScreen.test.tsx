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
import { chatStore } from '../services/ChatStore';

// chatStore is now a module-level singleton; messages must be wiped between
// tests so prior assertions don't bleed into later ones.
beforeEach(() => {
  chatStore.clear();
});

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

// ChatScreen was refactored to use askStream / askWithImageStream. The mock
// accepts the callbacks bag and resolves the full response via onToken + onDone,
// letting UI-level assertions ("guide bubble shows X") continue to work.
// `mockAsk` records the call args so assertions can inspect what was streamed.
const mockAsk = jest.fn();
let nextStreamResponse: string | { error: string } = 'You are near the Eiffel Tower.';

function mockAskStream(
  query: unknown,
  location: unknown,
  callbacks: { onToken: (d: string) => void; onDone: () => void; onError: (m: string) => void }
) {
  mockAsk(query, location);
  queueMicrotask(() => {
    if (typeof nextStreamResponse === 'object' && 'error' in nextStreamResponse) {
      callbacks.onError(nextStreamResponse.error);
      return;
    }
    callbacks.onToken(nextStreamResponse);
    callbacks.onDone();
  });
  return Promise.resolve({ abort: jest.fn().mockResolvedValue(undefined) });
}

jest.mock('../services/LocalGuideService', () => {
  const actual = jest.requireActual('../services/LocalGuideService');
  return {
    // Re-export the named helpers (extractCueSubject) that useGuideStream
    // imports from this module — without this they come back undefined and
    // every stream call throws "extractCueSubject is not a function".
    ...actual,
    localGuideService: {
      initialize: jest.fn().mockResolvedValue(undefined),
      ask: jest.fn(), // kept for backwards compat but no longer invoked by ChatScreen
      askStream: mockAskStream,
      askWithImageStream: mockAskStream,
      // useNearbyPois falls back to this when Wikipedia returns nothing; stub
      // it with a never-resolving promise so the hook stays in its loading
      // state and tests don't have to deal with llm-flavored POI rows.
      listNearbyPlaces: jest.fn(() => ({
        promise: new Promise<string[]>(() => {}),
        abort: jest.fn().mockResolvedValue(undefined),
      })),
      dispose: jest.fn().mockResolvedValue(undefined),
    },
  };
});

const mockSpeechEnqueue = jest.fn();
jest.mock('../services/SpeechService', () => ({
  speechService: {
    speak: (...args: unknown[]) => mockSpeechSpeak(...args),
    enqueue: (...args: unknown[]) => mockSpeechEnqueue(...args),
    stop: (...args: unknown[]) => mockSpeechStop(...args),
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
    expect(getByPlaceholderText("Ask about what's near you…")).toBeTruthy();
  });

  it('renders a Send button', () => {
    const { getByText } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );
    expect(getByText('↑')).toBeTruthy();
  });

  it('shows the Plan-my-day and Quiz CTAs on the Home empty state', () => {
    // Post-Option-A IA: Auto-Guide / Speak / Hidden-Gems toggles moved into
    // the settings sheet behind the gear. The Home state surfaces the two
    // primary destinations (Plan-my-day, Quiz) as the user's first choice
    // instead of toggle chrome.
    const { getByTestId } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );
    expect(getByTestId('home-plan-day')).toBeTruthy();
    expect(getByTestId('home-quiz')).toBeTruthy();
  });

  it('shows the Home greeting when no messages', () => {
    const { getByText } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );
    // Home state greets the visitor with a location headline ("You're in …"
    // when the place resolved, else "You're here.") and the "Want to
    // wander?" prompt.
    expect(getByText(/You're (in|here)/i)).toBeTruthy();
    expect(getByText(/Want to wander\?/)).toBeTruthy();
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
    mockSpeechEnqueue.mockClear();
    nextStreamResponse = 'You are near the Eiffel Tower.';
  });

  it('appends user message to the list after Send', async () => {
    const { getByPlaceholderText, getByText } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );

    const input = getByPlaceholderText("Ask about what's near you…");
    fireEvent.changeText(input, 'What is near me?');
    await act(async () => {
      fireEvent.press(getByText('↑'));
    });

    expect(getByText('What is near me?')).toBeTruthy();
  });

  it('appends guide response after inference resolves', async () => {
    const { getByPlaceholderText, getByText, findByText } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );

    const input = getByPlaceholderText("Ask about what's near you…");
    fireEvent.changeText(input, 'What is near me?');
    fireEvent.press(getByText('↑'));

    expect(await findByText('You are near the Eiffel Tower.')).toBeTruthy();
  });

  it('calls localGuideService.ask with the query and GPS', async () => {
    const { getByPlaceholderText, getByText } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );

    fireEvent.changeText(getByPlaceholderText("Ask about what's near you…"), 'test query');
    await act(async () => { fireEvent.press(getByText('↑')); });

    expect(mockAsk).toHaveBeenCalledWith(
      'test query',
      expect.objectContaining({ latitude: GPS.latitude, longitude: GPS.longitude })
    );
  });

  it('pipes the streamed response to speechService.enqueue when Speak is on', async () => {
    // Include a sentence terminator so the chunker releases the segment.
    nextStreamResponse = 'You are near the Eiffel Tower.';

    const { getByPlaceholderText, getByText } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );

    fireEvent.changeText(getByPlaceholderText("Ask about what's near you…"), 'speak test');
    await act(async () => { fireEvent.press(getByText('↑')); });

    await waitFor(() =>
      expect(mockSpeechEnqueue).toHaveBeenCalledWith('You are near the Eiffel Tower.')
    );
  });

  it('shows error message when the stream reports an error', async () => {
    nextStreamResponse = { error: 'model crash' };

    const { getByPlaceholderText, getByText, findByText } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );

    fireEvent.changeText(getByPlaceholderText("Ask about what's near you…"), 'crash test');
    fireEvent.press(getByText('↑'));

    expect(await findByText(/something went wrong/i)).toBeTruthy();
  });

  it('clears the text input after Send', async () => {
    const { getByPlaceholderText, getByText } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );

    const input = getByPlaceholderText("Ask about what's near you…");
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

    fireEvent.changeText(getByPlaceholderText("Ask about what's near you…"), 'where am I?');
    fireEvent.press(getByText('↑'));

    const matches = await findAllByText(/Location not available yet|GPS unavailable/i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Characterization: ChatScreen — message rendering', () => {
  it('renders both user and guide bubbles in a mixed conversation', async () => {
    const { useLocation } = require('../hooks/useLocation');
    useLocation.mockReturnValue(defaultLocationState);
    nextStreamResponse = 'Guide reply.';

    const { getByPlaceholderText, getByText, findByText, findAllByText } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );

    const input = getByPlaceholderText("Ask about what's near you…");
    fireEvent.changeText(input, 'Hello');

    await act(async () => { fireEvent.press(getByText('↑')); });

    // Screen may also auto-narrate POI cards; any matching guide bubble is fine.
    expect(await findByText('Hello')).toBeTruthy();
    const guideBubbles = await findAllByText('Guide reply.');
    expect(guideBubbles.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Characterization: ChatScreen — back nav preserves messages', () => {
  beforeEach(() => {
    const { useLocation } = require('../hooks/useLocation');
    useLocation.mockReturnValue(defaultLocationState);
    mockAsk.mockClear();
    nextStreamResponse = 'Guide reply.';
  });

  it('messages remain in chatStore after the back button is pressed', async () => {
    const { getByPlaceholderText, getByText, getByTestId, findByText } = render(
      <ChatScreen navigation={mockNavigation} route={chatRoute} />
    );

    // Send a message so there is conversation history.
    const input = getByPlaceholderText("Ask about what's near you…");
    fireEvent.changeText(input, 'Surviving message');
    await act(async () => { fireEvent.press(getByText('↑')); });
    // Wait for the guide reply so the stream has completed.
    await findByText('Guide reply.');

    // Press the back button (rendered by ChatHeader when hasMessages is true).
    await act(async () => { fireEvent.press(getByTestId('chat-back-btn')); });

    // chatStore should still have the conversation — no wipe on back-nav.
    const remaining = chatStore.getMessages();
    expect(remaining.length).toBeGreaterThanOrEqual(1);
    expect(remaining.some((m) => m.text === 'Surviving message')).toBe(true);
  });
});
