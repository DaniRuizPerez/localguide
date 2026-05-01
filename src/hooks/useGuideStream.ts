import { useCallback, useEffect, useRef, useState } from 'react';
import { localGuideService, type ChatTurn, type GuideTopic } from '../services/LocalGuideService';
import { speechService } from '../services/SpeechService';
import { SpeechChunker } from '../services/SpeechChunker';
import type { GPSContext, StreamHandle } from '../services/InferenceService';
import type { Message } from '../types/chat';
import type { ChatMessagesApi } from './useChatMessages';
import { appMode } from '../services/AppMode';
import type { Source } from '../components/SourceBadge';

export interface GuideStreamDeps {
  /** Message state surface — stream writes into it. */
  messages: ChatMessagesApi;
  /** Fresh ref to the current Speak toggle — read on each token. */
  speakResponsesRef: React.MutableRefObject<boolean>;
  /** Fresh ref to the current topic selection — read once per stream start. */
  topicRef: React.MutableRefObject<readonly GuideTopic[]>;
  /** Optional — called after every state mutation so the UI can scroll. */
  onScroll?: () => void;
}

export interface GuideStream {
  inferring: boolean;
  /**
   * Start a streaming response. Handles placeholder → onToken → onDone/onError
   * lifecycle, TTS chunking, and error fallbacks.
   *
   * `source` seeds the placeholder badge. Defaults to `'ai-online'` or
   * `'ai-offline'` based on appMode. Wave-2 callers (RAG, Wikipedia race)
   * can override at call-time or later via messages.setGuideSource(id, …).
   */
  stream(params: {
    intent: 'text' | 'image';
    query: string;
    location: GPSContext | string;
    imageUri?: string;
    source?: Source;
  }): Promise<void>;
  /** Abort an in-flight stream and silence TTS. No-op if nothing is running. */
  stop(): void;
}

export function useGuideStream({ messages, speakResponsesRef, topicRef, onScroll }: GuideStreamDeps): GuideStream {
  const [inferring, setInferring] = useState(false);
  const streamRef = useRef<StreamHandle | null>(null);
  const inferringRef = useRef(false);

  useEffect(() => {
    inferringRef.current = inferring;
  }, [inferring]);

  // Tear down on unmount: cancel any in-flight stream and stop TTS.
  useEffect(() => {
    return () => {
      streamRef.current?.abort();
      streamRef.current = null;
      speechService.stop();
    };
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.abort();
    streamRef.current = null;
    speechService.stop();
    setInferring(false);
  }, []);

  const stream = useCallback(
    async ({
      intent,
      query,
      location,
      imageUri,
      source,
    }: {
      intent: 'text' | 'image';
      query: string;
      location: GPSContext | string;
      imageUri?: string;
      source?: Source;
    }): Promise<void> => {
      // Snapshot prior turns for the model so a follow-up POI tap (or typed
      // question) lands in the same conversation thread instead of starting
      // fresh. addUserMessage queued a setState in the caller; React hasn't
      // re-rendered yet, so messages.messages is the state from BEFORE the
      // new user cue was appended — which is exactly the history we want.
      const history = priorTurnsFor(messages.messages);
      setInferring(true);
      // Default source from appMode so every guide bubble is tagged from day one.
      const resolvedSource: Source = source ?? (appMode.get() === 'online' ? 'ai-online' : 'ai-offline');
      const guideId = messages.addGuidePlaceholder(location, resolvedSource);
      onScroll?.();

      const chunker = new SpeechChunker((segment) => {
        if (speakResponsesRef.current) speechService.enqueue(segment);
      });
      const start = Date.now();

      return new Promise<void>((resolve) => {
        (async () => {
          try {
            const callbacks = {
              onToken: (delta: string) => {
                messages.appendGuideToken(guideId, delta);
                chunker.push(delta);
                onScroll?.();
              },
              onDone: () => {
                chunker.flush();
                messages.finalizeGuideMessage(guideId, Date.now() - start);
                streamRef.current = null;
                setInferring(false);
                onScroll?.();
                resolve();
              },
              onError: (message: string) => {
                messages.setGuideError(guideId, message);
                streamRef.current = null;
                setInferring(false);
                onScroll?.();
                resolve();
              },
            };
            const handle =
              intent === 'image' && imageUri
                ? await localGuideService.askWithImageStream(
                    query,
                    location,
                    imageUri,
                    callbacks,
                    topicRef.current,
                    history
                  )
                : await localGuideService.askStream(
                    query,
                    location,
                    callbacks,
                    topicRef.current,
                    history
                  );
            streamRef.current = handle;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            messages.setGuideError(guideId, message);
            streamRef.current = null;
            setInferring(false);
            resolve();
          }
        })();
      });
    },
    [messages, onScroll, speakResponsesRef, topicRef]
  );

  return { inferring, stream, stop };
}

/**
 * Map the chat message log to the small ChatTurn shape the model wants.
 * Drops the empty placeholder bubble that's still streaming, drops messages
 * with no text (errors that resolved to ''), and lets LocalGuideService
 * apply the turn-count + length caps.
 */
function priorTurnsFor(messages: readonly Message[]): ChatTurn[] {
  return messages
    .filter((m) => m.text && m.text.trim().length > 0)
    .map((m) => ({ role: m.role, text: m.text }));
}
