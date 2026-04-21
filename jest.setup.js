/**
 * Jest global setup. Loaded via setupFilesAfterEach in package.json.
 *
 * Mocks @react-native-async-storage/async-storage for every test suite so
 * modules that persist user prefs (NarrationPrefs, etc.) can be imported
 * without each test needing to stub the native module by hand.
 */

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
