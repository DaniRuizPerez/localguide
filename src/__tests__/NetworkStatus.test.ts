/**
 * NetworkStatus unit tests.
 * Mocks expo-network (addNetworkStateListener) and global.fetch.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// Capture the network listener registered by NetworkStatus so tests can fire events.
type NetworkListener = (event: { isConnected?: boolean }) => void;
let capturedNetworkListener: NetworkListener | null = null;

jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn((listener: NetworkListener) => {
    capturedNetworkListener = listener;
    return { remove: jest.fn() };
  }),
}));

// Provide a controllable fetch.
const mockFetch = jest.fn();
global.fetch = mockFetch as typeof fetch;

// Drain the microtask queue for fake-timer environments.
// Each loop of Promise.resolve() flushes one "level" of the chain.
async function flushMicrotasks(levels = 10): Promise<void> {
  for (let i = 0; i < levels; i++) {
    await Promise.resolve();
  }
}

// Import AFTER mocks are set up.
import { networkStatus } from '../services/NetworkStatus';

function makeOkResponse(): Response {
  return { ok: true, status: 200 } as Response;
}

beforeEach(async () => {
  jest.useFakeTimers();
  capturedNetworkListener = null;
  mockFetch.mockReset();
  networkStatus.__resetForTest();
  await AsyncStorage.clear();
});

afterEach(() => {
  networkStatus.__resetForTest();
  jest.useRealTimers();
});

describe('NetworkStatus', () => {
  it('starts as unknown before init', () => {
    expect(networkStatus.get()).toBe('unknown');
  });

  it('first probe success → online', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse());
    networkStatus.init();
    await flushMicrotasks();
    expect(networkStatus.get()).toBe('online');
  });

  it('first probe failure → stays unknown; second consecutive failure → offline', async () => {
    mockFetch.mockRejectedValueOnce(new Error('net err'));
    networkStatus.init();
    await flushMicrotasks();
    // One failure: still unknown.
    expect(networkStatus.get()).toBe('unknown');

    // Force a second probe failure.
    mockFetch.mockRejectedValueOnce(new Error('net err'));
    await networkStatus.forceProbe();
    expect(networkStatus.get()).toBe('offline');
  });

  it('isConnected:false event → offline immediately', async () => {
    // Complete initial probe so state is stable.
    mockFetch.mockResolvedValueOnce(makeOkResponse());
    networkStatus.init();
    await flushMicrotasks();
    expect(networkStatus.get()).toBe('online');

    // Now fire a disconnection event.
    capturedNetworkListener?.({ isConnected: false });
    expect(networkStatus.get()).toBe('offline');
  });

  it('subscriber notified on state change; no duplicate calls on same state', async () => {
    mockFetch.mockResolvedValue(makeOkResponse());
    networkStatus.init();
    const listener = jest.fn();
    const unsub = networkStatus.subscribe(listener);

    await flushMicrotasks();

    // First transition: unknown → online.
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('online');

    // Another successful probe: already online, no extra notification.
    await networkStatus.forceProbe();
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
  });

  it('recovery: periodic probe while offline transitions back to online', async () => {
    // Two consecutive failures → offline.
    mockFetch.mockRejectedValueOnce(new Error('fail'));
    networkStatus.init();
    await flushMicrotasks();

    mockFetch.mockRejectedValueOnce(new Error('fail'));
    await networkStatus.forceProbe();
    expect(networkStatus.get()).toBe('offline');

    // Next periodic re-probe succeeds.
    mockFetch.mockResolvedValueOnce(makeOkResponse());
    jest.advanceTimersByTime(90_001);
    await flushMicrotasks();
    expect(networkStatus.get()).toBe('online');
  });

  it('persistence write on state change', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse());
    networkStatus.init();
    await flushMicrotasks();

    const saved = await AsyncStorage.getItem('@localguide/network-state-v1');
    expect(saved).toBe('online');
  });
});
