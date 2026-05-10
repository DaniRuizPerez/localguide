// Shared chat singleton — mirrors the publisher pattern in RadiusPrefs /
// GuidePrefs so multiple screens (ChatScreen and the Map pullup's Chat tab)
// can render the same Message[] + inferring flag without lifting state via
// React Context. Messages are persisted to AsyncStorage with a debounced
// write so conversations survive full app restarts.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GPSContext } from './InferenceService';
import type { Message } from '../types/chat';
import type { Source } from '../components/SourceBadge';

export interface ChatStoreSnapshot {
  messages: Message[];
  inferring: boolean;
}

const STORAGE_KEY = 'chat-messages-v1';
const MAX_MESSAGES = 200;
const DEBOUNCE_MS = 500;

let idSeq = 0;
function nextId(prefix: string): string {
  idSeq += 1;
  return `${Date.now()}-${idSeq}-${prefix}`;
}

let messages: Message[] = [];
let inferring = false;
const subscribers = new Set<(snap: ChatStoreSnapshot) => void>();

function snapshot(): ChatStoreSnapshot {
  return { messages, inferring };
}

function notify(): void {
  const snap = snapshot();
  for (const cb of subscribers) cb(snap);
}

// ── AsyncStorage persistence ──────────────────────────────────────────────

let _persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(): void {
  if (_persistTimer !== null) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    const toSave = messages.slice(-MAX_MESSAGES);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(toSave)).catch(() => {
      // Best-effort — swallow silently.
    });
  }, DEBOUNCE_MS);
}

// Hydrate on module import. Skip if messages already populated (a mutation
// fired between import and hydration completing — in-memory state wins).
(async () => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw == null) return;
    const loaded: Message[] = JSON.parse(raw);
    if (!Array.isArray(loaded)) return;
    // Skip hydration if a mutation has already pushed messages into the store.
    if (messages.length > 0) return;
    messages = loaded.slice(-MAX_MESSAGES);
    notify();
  } catch (e) {
    if (__DEV__) {
      console.warn('[ChatStore] hydration failed:', e);
    }
  }
})();

export const chatStore = {
  get(): ChatStoreSnapshot {
    return snapshot();
  },

  // `opts.subjectPoi` carries POI subject anchors for follow-up turns — see
  // Message in src/types/chat.ts for the tri-state semantics. Set explicitly
  // by POI taps and the area-reset chip; omitted for free-typed text/voice
  // (those fall back to inheritance + live cue inference at stream time).
  addUserMessage(
    text: string,
    opts?: { imageUri?: string; subjectPoi?: string | null }
  ): string {
    const id = nextId('u');
    const message: Message = {
      id,
      role: 'user',
      text,
      ...(opts?.imageUri !== undefined ? { imageUri: opts.imageUri } : {}),
      ...(opts?.subjectPoi !== undefined ? { subjectPoi: opts.subjectPoi } : {}),
    };
    const next = [...messages, message];
    messages = next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
    notify();
    schedulePersist();
    return id;
  },

  addGuideMessage(
    text: string,
    locationUsed: GPSContext | string,
    durationMs?: number,
    source?: Source
  ): string {
    const id = nextId('g');
    const next = [...messages, { id, role: 'guide' as const, text, locationUsed, durationMs, source }];
    messages = next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
    notify();
    schedulePersist();
    return id;
  },

  addGuidePlaceholder(locationUsed: GPSContext | string, source?: Source): string {
    const id = nextId('gp');
    const next = [...messages, { id, role: 'guide' as const, text: '', locationUsed, source }];
    messages = next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
    notify();
    schedulePersist();
    return id;
  },

  appendGuideToken(id: string, delta: string): void {
    let changed = false;
    messages = messages.map((m) => {
      if (m.id !== id) return m;
      changed = true;
      return { ...m, text: m.text + delta };
    });
    if (changed) { notify(); schedulePersist(); }
  },

  // Overwrites a streaming bubble's body in one shot. Used by the response
  // postfilter when an abort needs to replace the in-flight tail (e.g. strip
  // a repeating block and append a "(stopped — repeating)" trailer).
  replaceGuideText(id: string, fullText: string): void {
    let changed = false;
    messages = messages.map((m) => {
      if (m.id !== id) return m;
      changed = true;
      return { ...m, text: fullText };
    });
    if (changed) { notify(); schedulePersist(); }
  },

  finalizeGuideMessage(id: string, durationMs?: number): void {
    let changed = false;
    messages = messages.map((m) => {
      if (m.id !== id) return m;
      changed = true;
      return { ...m, text: m.text.trim(), durationMs };
    });
    if (changed) { notify(); schedulePersist(); }
  },

  // Replaces a streaming bubble's text with an error string only if it's still
  // empty (the stream produced no tokens before failing). Mirrors the prior
  // useChatMessages behaviour exactly.
  setGuideError(id: string, message: string): void {
    let changed = false;
    messages = messages.map((m) => {
      if (m.id !== id) return m;
      changed = true;
      return {
        ...m,
        text: m.text || `Sorry, something went wrong. (${message})`,
      };
    });
    if (changed) { notify(); schedulePersist(); }
  },

  setGuideSource(id: string, source: Source): void {
    let changed = false;
    messages = messages.map((m) => {
      if (m.id !== id) return m;
      changed = true;
      return { ...m, source };
    });
    if (changed) { notify(); schedulePersist(); }
  },

  setInferring(value: boolean): void {
    if (inferring === value) return;
    inferring = value;
    notify();
    // inferring is transient session state — not persisted.
  },

  clear(): void {
    messages = [];
    inferring = false;
    notify();
    schedulePersist();
  },

  /** Convenience accessor for tests and components that just need the array. */
  getMessages(): Message[] {
    return messages;
  },

  subscribe(cb: (snap: ChatStoreSnapshot) => void): () => void {
    subscribers.add(cb);
    return () => {
      subscribers.delete(cb);
    };
  },
};
