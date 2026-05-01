/**
 * AppMode — resolver matrix + reactive subscription.
 */

// Stub expo-network before any import so NetworkStatus doesn't try to register a real listener.
jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));

import { resolve, appMode } from '../services/AppMode';
import { guidePrefs } from '../services/GuidePrefs';
import { networkStatus } from '../services/NetworkStatus';

beforeEach(() => {
  guidePrefs.__resetForTest();
  networkStatus.__resetForTest();
  appMode.__resetForTest();
});

afterEach(() => {
  appMode.__resetForTest();
  networkStatus.__resetForTest();
  guidePrefs.__resetForTest();
});

describe('resolve() — pure resolver', () => {
  it('auto + unknown → online (optimistic)', () => {
    expect(resolve('auto', 'unknown')).toBe('online');
  });

  it('auto + online → online', () => {
    expect(resolve('auto', 'online')).toBe('online');
  });

  it('auto + offline → offline', () => {
    expect(resolve('auto', 'offline')).toBe('offline');
  });

  it('force-online + offline → online', () => {
    expect(resolve('force-online', 'offline')).toBe('online');
  });

  it('force-online + unknown → online', () => {
    expect(resolve('force-online', 'unknown')).toBe('online');
  });

  it('force-offline + online → offline', () => {
    expect(resolve('force-offline', 'online')).toBe('offline');
  });

  it('force-offline + unknown → offline', () => {
    expect(resolve('force-offline', 'unknown')).toBe('offline');
  });
});

describe('appMode reactive', () => {
  it('initial get() reflects defaults (auto + unknown → online)', () => {
    expect(appMode.get()).toBe('online');
  });

  it('notifies subscriber when modeChoice changes', async () => {
    const listener = jest.fn();
    const unsub = appMode.subscribe(listener);

    // Default is auto+unknown=online. Flip to force-offline → should trigger offline.
    guidePrefs.setModeChoice('force-offline');
    // Wait one microtask for the subscriber chain.
    await Promise.resolve();

    expect(listener).toHaveBeenCalledWith('offline');
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
  });

  it('does not notify when effective mode is unchanged', async () => {
    const listener = jest.fn();
    const unsub = appMode.subscribe(listener);

    // auto+unknown=online; setting force-online also gives online → no notification.
    guidePrefs.setModeChoice('force-online');
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();

    unsub();
  });

  it('unsubscribe stops future notifications', async () => {
    const listener = jest.fn();
    const unsub = appMode.subscribe(listener);
    unsub();

    guidePrefs.setModeChoice('force-offline');
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
  });
});
