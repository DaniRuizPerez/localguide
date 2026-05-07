// Shared chat singleton — mirrors the publisher pattern in RadiusPrefs /
// GuidePrefs so multiple screens (ChatScreen and the Map pullup's Chat tab)
// can render the same Message[] + inferring flag without lifting state via
// React Context. In-memory only — chat is intentionally session-scoped.

import type { GPSContext } from './InferenceService';
import type { Message } from '../types/chat';
import type { Source } from '../components/SourceBadge';

export interface ChatStoreSnapshot {
  messages: Message[];
  inferring: boolean;
}

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

export const chatStore = {
  get(): ChatStoreSnapshot {
    return snapshot();
  },

  addUserMessage(text: string, imageUri?: string): string {
    const id = nextId('u');
    messages = [...messages, { id, role: 'user', text, imageUri }];
    notify();
    return id;
  },

  addGuideMessage(
    text: string,
    locationUsed: GPSContext | string,
    durationMs?: number,
    source?: Source
  ): string {
    const id = nextId('g');
    messages = [...messages, { id, role: 'guide', text, locationUsed, durationMs, source }];
    notify();
    return id;
  },

  addGuidePlaceholder(locationUsed: GPSContext | string, source?: Source): string {
    const id = nextId('gp');
    messages = [...messages, { id, role: 'guide', text: '', locationUsed, source }];
    notify();
    return id;
  },

  appendGuideToken(id: string, delta: string): void {
    let changed = false;
    messages = messages.map((m) => {
      if (m.id !== id) return m;
      changed = true;
      return { ...m, text: m.text + delta };
    });
    if (changed) notify();
  },

  finalizeGuideMessage(id: string, durationMs?: number): void {
    let changed = false;
    messages = messages.map((m) => {
      if (m.id !== id) return m;
      changed = true;
      return { ...m, text: m.text.trim(), durationMs };
    });
    if (changed) notify();
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
    if (changed) notify();
  },

  setGuideSource(id: string, source: Source): void {
    let changed = false;
    messages = messages.map((m) => {
      if (m.id !== id) return m;
      changed = true;
      return { ...m, source };
    });
    if (changed) notify();
  },

  setInferring(value: boolean): void {
    if (inferring === value) return;
    inferring = value;
    notify();
  },

  clear(): void {
    messages = [];
    inferring = false;
    notify();
  },

  subscribe(cb: (snap: ChatStoreSnapshot) => void): () => void {
    subscribers.add(cb);
    return () => {
      subscribers.delete(cb);
    };
  },
};
