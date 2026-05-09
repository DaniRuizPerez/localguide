import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Network from 'expo-network';

// Wraps connectivity events + active probing into a single observable.
// Two-failure threshold + isConnected:false event → offline.
// Periodic 90s re-probe while offline for recovery.

export type NetworkState = 'online' | 'offline' | 'unknown';

const STORAGE_KEY = '@localguide/network-state-v1';
const PROBE_URL = 'https://en.wikipedia.org/api/rest_v1/page/summary/Earth';
const PROBE_TIMEOUT_MS = 5_000;
// Re-probe every 90 s regardless of state. Why also when online: the OS only
// fires isConnected:false when the WiFi/cell link itself drops; if the link
// stays up but the upstream internet is unreachable (captive portal, dead
// gateway, airplane mode flipped while WiFi remembered), no OS event arrives
// and the state stays stuck on "online" forever. The pill ends up lying.
const REPOLL_INTERVAL_MS = 90_000;
// One opportunistic failure per 30s window counts toward the threshold.
const OPP_FAILURE_WINDOW_MS = 30_000;

type Listener = (s: NetworkState) => void;

let state: NetworkState = 'unknown';
let initialized = false;
const listeners = new Set<Listener>();
let consecutiveFailures = 0;
let repollTimer: ReturnType<typeof setInterval> | null = null;
let networkSubscription: { remove(): void } | null = null;
let lastOppFailureAt = 0;

function notify(): void {
  for (const l of listeners) l(state);
}

function persist(s: NetworkState): void {
  AsyncStorage.setItem(STORAGE_KEY, s).catch(() => {});
}

function transition(next: NetworkState): void {
  if (next === state) return;
  state = next;
  persist(next);
  notify();
  manageRepollTimer();
}

function manageRepollTimer(): void {
  // Run the timer in every state. Previously this was only armed while
  // offline, which meant a silent loss of connectivity (link still up,
  // upstream dead) left the pill stuck on "online" indefinitely.
  if (!repollTimer) {
    repollTimer = setInterval(() => {
      runProbe().catch(() => {});
    }, REPOLL_INTERVAL_MS);
  }
}

async function runProbe(): Promise<void> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    // Wikipedia rejects unidentified UAs with HTTP 403 (User-Agent policy).
    const res = await fetch(PROBE_URL, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { 'User-Agent': 'LocalGuide/1.0 (contact: daniruizperez93@gmail.com; https://github.com/DaniRuizPerez/localguide)' },
    });
    if (res.ok) {
      consecutiveFailures = 0;
      transition('online');
    } else {
      handleProbeFail();
    }
  } catch {
    handleProbeFail();
  } finally {
    clearTimeout(id);
  }
}

function handleProbeFail(): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= 2) {
    transition('offline');
    return;
  }
  // One failure alone leaves state unchanged (stays 'unknown' or 'online').
  // Schedule a fast follow-up probe so the second failure (which actually
  // flips the state) lands in seconds rather than waiting REPOLL_INTERVAL_MS.
  setTimeout(() => {
    runProbe().catch(() => {});
  }, 5_000);
}

function handleNetworkEvent(event: { isConnected?: boolean }): void {
  if (event.isConnected === false) {
    consecutiveFailures = 2; // bypass threshold
    transition('offline');
  } else if (event.isConnected === true) {
    // Connectivity restored — probe to confirm actual reachability.
    runProbe().catch(() => {});
  }
}

// Opportunistic signals from other services (Wikipedia fetch, Maps). Success
// always flips online. Failures are rate-limited to prevent a single bad
// request from flapping the state.
export function recordOpportunisticSuccess(): void {
  consecutiveFailures = 0;
  transition('online');
}

export function recordOpportunisticFailure(): void {
  const now = Date.now();
  if (now - lastOppFailureAt < OPP_FAILURE_WINDOW_MS) return;
  lastOppFailureAt = now;
  handleProbeFail();
}

export const networkStatus = {
  init(): void {
    if (initialized) return;
    initialized = true;

    // Seed from last-known persisted value so UI can paint without waiting for probe.
    // Use transition() rather than a direct assignment so subscribers (notably
    // appMode.recompute) actually run — appMode.effective is captured at module
    // load when state is still 'unknown' and would otherwise stay stuck on
    // 'online' (the optimistic resolve) until the next genuine transition.
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw === 'online' || raw === 'offline') {
          if (state === 'unknown') transition(raw);
        }
      })
      .catch(() => {})
      .finally(() => {
        runProbe().catch(() => {});
      });

    // Arm the periodic re-probe immediately so reachability is checked even
    // if no transition (or no OS connectivity event) has happened yet.
    manageRepollTimer();

    // Edge events from the OS — faster than probing for disconnect detection.
    try {
      networkSubscription = Network.addNetworkStateListener(handleNetworkEvent);
    } catch {
      // Module unavailable in test environments or old Expo versions — probe-only mode.
    }
  },

  get(): NetworkState {
    return state;
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  async forceProbe(): Promise<void> {
    await runProbe();
  },

  __resetForTest(): void {
    state = 'unknown';
    initialized = false;
    consecutiveFailures = 0;
    lastOppFailureAt = 0;
    listeners.clear();
    if (repollTimer) {
      clearInterval(repollTimer);
      repollTimer = null;
    }
    if (networkSubscription) {
      networkSubscription.remove();
      networkSubscription = null;
    }
  },
};
