import { useCallback, useEffect, useRef, useState } from 'react';
import { localGuideService, type GuideTopic } from '../services/LocalGuideService';
import { speechService } from '../services/SpeechService';
import { SpeechChunker } from '../services/SpeechChunker';
import type { GPSContext, StreamHandle } from '../services/InferenceService';
import type { ChatMessagesApi } from './useChatMessages';

export interface GuideStreamDeps {
  /** Message state surface — stream writes into it. */
  messages: ChatMessagesApi;
  /** Fresh ref to the current Speak toggle — read on each token. */
  speakResponsesRef: React.MutableRefObject<boolean>;
  /** Fresh ref to the current topic — read once per stream start. */
  topicRef: React.MutableRefObject<GuideTopic>;
  /** Optional — called after every state mutation so the UI can scroll. */
  onScroll?: () => void;
}

export interface GuideStream {
  inferring: boolean;
  /**
   * Start a streaming response. Handles placeholder → onToken → onDone/onError
   * lifecycle, TTS chunking, and error fallbacks.
   */
  stream(params: {
    intent: 'text' | 'image';
    query: string;
    location: GPSContext | string;
    imageUri?: string;
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
    }: {
      intent: 'text' | 'image';
      query: string;
      location: GPSContext | string;
      imageUri?: string;
    }): Promise<void> => {
      setInferring(true);
      const guideId = messages.addGuidePlaceholder(location);
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
                    topicRef.current
                  )
                : await localGuideService.askStream(query, location, callbacks, topicRef.current);
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
