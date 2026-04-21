/**
 * Mock factories for test files.
 *
 * How to use: call a factory inside your test's `jest.mock(...)` block.
 * The factories return fresh instances so call-count spies don't leak
 * between suites.
 *
 *   jest.mock('expo-speech-recognition', () =>
 *     require('../__fixtures__/mocks').createSpeechRecognitionMock()
 *   );
 *
 * The truly-universal mocks (AsyncStorage, the native LiteRT module,
 * react-native-maps, expo-task-manager, expo-keep-awake, expo-sensors,
 * react-native-community/slider) are installed globally in jest.setup.js
 * so tests don't need to mock them at all unless overriding behaviour.
 */

export const createSpeechRecognitionMock = () => ({
  ExpoSpeechRecognitionModule: {
    requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
    getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
    start: jest.fn(),
    stop: jest.fn(),
    abort: jest.fn(),
  },
  useSpeechRecognitionEvent: jest.fn(),
});

export const createExpoSpeechMock = () => ({
  speak: jest.fn(),
  stop: jest.fn(),
  isSpeakingAsync: jest.fn().mockResolvedValue(false),
  getAvailableVoicesAsync: jest.fn().mockResolvedValue([]),
});

export const createImagePickerMock = (overrides?: {
  cameraStatus?: string;
  launchResult?: {
    canceled?: boolean;
    assets?: Array<{ uri: string }>;
  };
}) => ({
  requestCameraPermissionsAsync: jest
    .fn()
    .mockResolvedValue({ status: overrides?.cameraStatus ?? 'granted' }),
  launchCameraAsync: jest
    .fn()
    .mockResolvedValue(overrides?.launchResult ?? { canceled: true }),
  MediaTypeOptions: { Images: 'Images' },
});

export const createExpoLocationMock = (
  coords: { latitude: number; longitude: number; accuracy?: number } = {
    latitude: 48.8566,
    longitude: 2.3522,
    accuracy: 10,
  }
) => ({
  Accuracy: { Balanced: 3, High: 4 },
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest
    .fn()
    .mockResolvedValue({ coords: { accuracy: null, ...coords } }),
  watchPositionAsync: jest.fn().mockResolvedValue({ remove: jest.fn() }),
  requestBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
  startLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
  stopLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
  reverseGeocodeAsync: jest.fn().mockResolvedValue([]),
});

/**
 * The SpeechService used by components that don't want to drive it via
 * real state. Returns a frozen-ish mock — replace individual jest.fns
 * with your own before using.
 */
export const createSpeechServiceMock = () => ({
  speak: jest.fn(),
  enqueue: jest.fn(),
  stop: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  skipCurrent: jest.fn(),
  setRate: jest.fn(),
  setVoice: jest.fn(),
  rate: 0.95,
  voice: undefined as string | undefined,
  isSpeaking: false,
  isPaused: false,
  queueLength: 0,
  getState: () => ({ isSpeaking: false, isPaused: false, queueLength: 0 }),
  subscribe: () => () => {},
  getAvailableVoices: jest.fn().mockResolvedValue([]),
});
