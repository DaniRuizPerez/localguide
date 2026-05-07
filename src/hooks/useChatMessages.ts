import { useCallback, useEffect, useState } from 'react';
import type { GPSContext } from '../services/InferenceService';
import type { Message } from '../types/chat';
import type { Source } from '../components/SourceBadge';
import { chatStore } from '../services/ChatStore';

export interface ChatMessagesApi {
  messages: Message[];
  /** Append a user turn (typed, voice, POI cue). Returns its id. */
  addUserMessage(text: string, imageUri?: string): string;
  /** Append a final guide bubble (used by auto-guide replies). Returns its id. */
  addGuideMessage(
    text: string,
    locationUsed: GPSContext | string,
    durationMs?: number,
    source?: Source
  ): string;
  /**
   * Add an empty guide bubble that will fill via appendGuideToken as the
   * stream runs. Returns its id — caller passes that id to finalize/replace.
   */
  addGuidePlaceholder(locationUsed: GPSContext | string, source?: Source): string;
  /** Append a delta to a specific guide message (streaming tokens). */
  appendGuideToken(id: string, delta: string): void;
  /** Mark a streaming message complete — trims text, records duration. */
  finalizeGuideMessage(id: string, durationMs: number): void;
  /**
   * Replace a streaming message's text with an error string if the stream
   * produced no tokens before failing, otherwise keep what's already there.
   */
  setGuideError(id: string, message: string): void;
  /**
   * Overwrite the source badge on an existing guide message.
   * Used mid-stream when a grounded path (RAG, Wikipedia race) resolves.
   * No-op if id is not found.
   */
  setGuideSource(id: string, source: Source): void;
  /** Drop all messages. */
  clear(): void;
}

/**
 * Thin reactive wrapper around the shared `chatStore` singleton. Both
 * ChatScreen and the Map pullup's Chat tab call this hook independently —
 * each subscriber re-renders when messages or inferring change. The store
 * coalesces no-op token writes so we don't pay for a rerender per token
 * across multiple mounted MessageLists.
 */
export function useChatMessages(): ChatMessagesApi {
  const [snap, setSnap] = useState(() => chatStore.get());

  useEffect(() => {
    return chatStore.subscribe(setSnap);
  }, []);

  const addUserMessage = useCallback((text: string, imageUri?: string) => {
    return chatStore.addUserMessage(text, imageUri);
  }, []);

  const addGuideMessage = useCallback(
    (text: string, locationUsed: GPSContext | string, durationMs?: number, source?: Source) => {
      return chatStore.addGuideMessage(text, locationUsed, durationMs, source);
    },
    []
  );

  const addGuidePlaceholder = useCallback(
    (locationUsed: GPSContext | string, source?: Source) => {
      return chatStore.addGuidePlaceholder(locationUsed, source);
    },
    []
  );

  const appendGuideToken = useCallback((id: string, delta: string) => {
    chatStore.appendGuideToken(id, delta);
  }, []);

  const finalizeGuideMessage = useCallback((id: string, durationMs: number) => {
    chatStore.finalizeGuideMessage(id, durationMs);
  }, []);

  const setGuideError = useCallback((id: string, message: string) => {
    chatStore.setGuideError(id, message);
  }, []);

  const setGuideSource = useCallback((id: string, source: Source) => {
    chatStore.setGuideSource(id, source);
  }, []);

  const clear = useCallback(() => chatStore.clear(), []);

  return {
    messages: snap.messages,
    addUserMessage,
    addGuideMessage,
    addGuidePlaceholder,
    appendGuideToken,
    finalizeGuideMessage,
    setGuideError,
    setGuideSource,
    clear,
  };
}
