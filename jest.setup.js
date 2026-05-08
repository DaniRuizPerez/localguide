/**
 * Jest global setup. Loaded via setupFilesAfterEach in package.json.
 *
 * Globalises the mocks that are truly identical across every test file —
 * async-storage, the native LiteRT module, react-native-maps, and a few
 * Expo modules whose default no-op shape never needs per-test customising.
 *
 * Tests that need different behaviour can still override with their own
 * `jest.mock(...)` call — per-file mocks take precedence over this setup.
 */

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Native on-device inference module — the JS side conditionally uses a
// mock stream when this is undefined, which every test relies on.
jest.mock(
  './src/native/LiteRTModule',
  () => ({ __esModule: true, default: undefined }),
  { virtual: false }
);

// Tasks + keep-awake: tests never exercise real native behaviour, and every
// file that touched them had an identical stub.
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn().mockResolvedValue(false),
}));

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn().mockResolvedValue(undefined),
  deactivateKeepAwake: jest.fn().mockResolvedValue(undefined),
}));

// Magnetometer is the sole expo-sensors API we use. Only CompassArrow.test
// overrides this, and does so with its own jest.mock which takes precedence.
jest.mock('expo-sensors', () => ({
  Magnetometer: {
    isAvailableAsync: jest.fn().mockResolvedValue(false),
    setUpdateInterval: jest.fn(),
    addListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
  },
}));

// react-native-safe-area-context reads insets from a native provider. Tests
// don't mount SafeAreaProvider, so return a zero-inset stub — sufficient for
// any component that only uses insets to add padding.
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  const inset = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    SafeAreaProvider: ({ children }) => React.createElement(View, null, children),
    SafeAreaView: ({ children, ...props }) => React.createElement(View, props, children),
    SafeAreaInsetsContext: { Consumer: ({ children }) => children(inset) },
    useSafeAreaInsets: () => inset,
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 0, height: 0 }),
  };
});

// React Native community slider is a native component; tests don't render
// native views, so a stub View carrying the props through is all we need.
jest.mock('@react-native-community/slider', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props) => React.createElement(View, { testID: 'rate-slider', ...props }),
  };
});

// expo-device — stub the native bridge so tests don't hit real device APIs.
// DevicePerf.test.ts overrides this with its own controllable mock.
jest.mock('expo-device', () => ({
  totalMemory: 8 * 1024 * 1024 * 1024, // 8 GB — fast default
}));

// react-native-svg — stub all SVG primitives so tests can render components
// that use inline SVG without a native bridge. Each element is a plain View
// or null so React-Testing-Library can inspect the tree.
jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  const Svg = ({ children, ...props }) =>
    React.createElement(View, { testID: 'svg-root', ...props }, children);
  const Circle = (props) => React.createElement(View, { testID: 'svg-circle', ...props });
  const Line = (props) => React.createElement(View, { testID: 'svg-line', ...props });
  const Path = (props) => React.createElement(View, { testID: 'svg-path', ...props });
  const Polyline = ({ children, ...props }) =>
    React.createElement(View, { testID: 'svg-polyline', ...props }, children);
  const Rect = (props) => React.createElement(View, { testID: 'svg-rect', ...props });
  const SvgText = ({ children, ...props }) =>
    React.createElement(Text, { testID: 'svg-text', ...props }, children);
  const G = ({ children, ...props }) =>
    React.createElement(View, { testID: 'svg-g', ...props }, children);
  return {
    __esModule: true,
    default: Svg,
    Svg,
    Circle,
    Line,
    Path,
    Polyline,
    Rect,
    Text: SvgText,
    G,
  };
});

// expo-speech-recognition — stub the native module so any file that imports
// useVoiceInput (which calls useSpeechRecognitionEvent) doesn't crash at
// module load time. Tests that exercise voice behaviour can override.
jest.mock('expo-speech-recognition', () => ({
  useSpeechRecognitionEvent: jest.fn(),
}));

// @sentry/react-native — stub so tests never hit the native Sentry bridge.
// All capture methods are no-ops; Sentry.wrap passes the component through.
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  wrap: (component) => component,
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
  setUser: jest.fn(),
  setTag: jest.fn(),
  setExtra: jest.fn(),
  withScope: jest.fn((cb) => cb({ setTag: jest.fn(), setExtra: jest.fn() })),
}));

// expo-image-picker — stub so tests never hit the camera native bridge.
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  launchCameraAsync: jest.fn().mockResolvedValue({ canceled: true, assets: [] }),
  MediaTypeOptions: { Images: 'Images' },
}));

// VoiceRecognitionService — stub the native mic bridge.
jest.mock('./src/services/VoiceRecognitionService', () => ({
  voiceRecognitionService: {
    isAvailable: jest.fn().mockResolvedValue(false),
    requestPermission: jest.fn().mockResolvedValue(false),
    start: jest.fn(),
    stop: jest.fn(),
  },
}));

// useUnitPref — always return 'km' in tests so distance-formatting assertions
// are locale-independent (tests use metric expectations like "4.X km", "m").
jest.mock('./src/hooks/useUnitPref', () => ({
  useUnitPref: () => ({ units: 'km', setUnits: jest.fn() }),
}));

// react-native-maps calls TurboModuleRegistry.getEnforcing at import time.
// Stub MapView/Marker/Polyline so tests can render them as plain Views.
jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MapView = React.forwardRef(function MapView(props, _ref) {
    return React.createElement(View, { testID: 'map-view', ...props });
  });
  const Marker = (props) => React.createElement(View, { testID: 'map-marker', ...props });
  const Polyline = (props) => React.createElement(View, { testID: 'map-polyline', ...props });
  return {
    __esModule: true,
    default: MapView,
    Marker,
    Polyline,
    PROVIDER_GOOGLE: 'google',
  };
});
