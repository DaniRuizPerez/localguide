import { useCallback, useState } from 'react';
import type { GPSContext } from '../services/InferenceService';
import type { Message } from '../types/chat';

let idSeq = 0;
function nextId(prefix: string): string {
  idSeq += 1;
  return `${Date.now()}-${idSeq}-${prefix}`;
}

export interface ChatMessagesApi {
  messages: Message[];
  /** Append a user turn (typed, voice, POI cue). Returns its id. */
  addUserMessage(text: string, imageUri?: string): string;
  /** Append a final guide bubble (used by auto-guide replies). Returns its id. */
  addGuideMessage(
    text: string,
    locationUsed: GPSContext | string,
    durationMs?: number
  ): string;
  /**
   * Add an empty guide bubble that will fill via appendGuideToken as the
   * stream runs. Returns its id — caller passes that id to finalize/replace.
   */
  addGuidePlaceholder(locationUsed: GPSContext | string): string;
  /** Append a delta to a specific guide message (streaming tokens). */
  appendGuideToken(id: string, delta: string): void;
  /** Mark a streaming message complete — trims text, records duration. */
  finalizeGuideMessage(id: string, durationMs: number): void;
  /**
   * Replace a streaming message's text with an error string if the stream
   * produced no tokens before failing, otherwise keep what's already there.
   */
  setGuideError(id: string, message: string): void;
  /** Drop all messages. */
  clear(): void;
}

export function useChatMessages(): ChatMessagesApi {
  const [messages, setMessages] = useState<Message[]>([]);

  const addUserMessage = useCallback((text: string, imageUri?: string): string => {
    const id = nextId('u');
    setMessages((prev) => [...prev, { id, role: 'user', text, imageUri }]);
    return id;
  }, []);

  const addGuideMessage = useCallback(
    (text: string, locationUsed: GPSContext | string, durationMs?: number): string => {
      const id = nextId('g');
      setMessages((prev) => [...prev, { id, role: 'guide', text, locationUsed, durationMs }]);
      return id;
    },
    []
  );

  const addGuidePlaceholder = useCallback((locationUsed: GPSContext | string): string => {
    const id = nextId('gp');
    setMessages((prev) => [...prev, { id, role: 'guide', text: '', locationUsed }]);
    return id;
  }, []);

  const appendGuideToken = useCallback((id: string, delta: string): void => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, text: m.text + delta } : m)));
  }, []);

  const finalizeGuideMessage = useCallback((id: string, durationMs: number): void => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, text: m.text.trim(), durationMs } : m))
    );
  }, []);

  const setGuideError = useCallback((id: string, message: string): void => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id ? { ...m, text: m.text || `Sorry, something went wrong. (${message})` } : m
      )
    );
  }, []);

  const clear = useCallback(() => setMessages([]), []);

  return {
    messages,
    addUserMessage,
    addGuideMessage,
    addGuidePlaceholder,
    appendGuideToken,
    finalizeGuideMessage,
    setGuideError,
    clear,
  };
}
