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
