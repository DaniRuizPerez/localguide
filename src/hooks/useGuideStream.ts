import { useCallback, useEffect, useRef, useState } from 'react';
import { localGuideService, type ChatTurn, type GuideTopic } from '../services/LocalGuideService';
import { speechService } from '../services/SpeechService';
import { SpeechChunker } from '../services/SpeechChunker';
import type { GPSContext, StreamHandle } from '../services/InferenceService';
import type { Message } from '../types/chat';
import { chatStore } from '../services/ChatStore';
import { appMode } from '../services/AppMode';
import type { Source } from '../components/SourceBadge';
import { devicePerf } from '../services/DevicePerf';
import { StreamPostfilter, trailerFor } from '../services/responsePostfilter';

// W2 imports — OnlineGuideService routing
import { onlineGuideService } from '../services/OnlineGuideService';

export interface GuideStreamDeps {
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
   * can override at call-time or later via chatStore.setGuideSource(id, …).
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

export function useGuideStream({ speakResponsesRef, topicRef, onScroll }: GuideStreamDeps): GuideStream {
  // Local mirror of chatStore.inferring so React re-renders this consumer
  // when streams start/end. The store is the source of truth — multiple
  // mounted screens stay in sync.
  const [inferring, setInferringLocal] = useState(chatStore.get().inferring);
  const streamRef = useRef<StreamHandle | null>(null);

  useEffect(() => {
    return chatStore.subscribe((snap) => setInferringLocal(snap.inferring));
  }, []);

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
    chatStore.setInferring(false);
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
      // fresh. The user message has already been added to the store by the
      // caller (ChatScreen / MapScreen). We exclude the just-added user
      // bubble from history because the model receives `query` separately.
      const allMessages = chatStore.get().messages;
      // Drop the trailing user message that matches the current query so we
      // don't double-send it.
      const historyMessages =
        allMessages.length > 0 &&
        allMessages[allMessages.length - 1].role === 'user' &&
        allMessages[allMessages.length - 1].text === query
          ? allMessages.slice(0, -1)
          : allMessages;
      const history = priorTurnsFor(historyMessages);
      chatStore.setInferring(true);
      // Default source from appMode so every guide bubble is tagged from day one.
      const resolvedSource: Source = source ?? (appMode.get() === 'online' ? 'ai-online' : 'ai-offline');
      const guideId = chatStore.addGuidePlaceholder(location, resolvedSource);
      onScroll?.();

      const chunker = new SpeechChunker((segment) => {
        if (speakResponsesRef.current) speechService.enqueue(segment);
      });
      const postfilter = new StreamPostfilter();
      // Race guard: streamHandle.abort() is best-effort on the native side and
      // one or two onToken events can land after we asked it to stop. Without
      // this we'd double-finalize and re-append junk to a bubble we already
      // cleaned up.
      let aborted = false;
      const start = Date.now();
      let deltaCount = 0;

      // Shared by both onToken sites (RAG path + offline/image path). When the
      // postfilter trips, replace the bubble body with the cleaned tail + a
      // trailer, stop TTS, and finalise. Returns true if aborted (caller should
      // bail out of the rest of its onToken handler).
      const handleAbortIfNeeded = (
        guideId: string,
        delta: string,
        onDoneExtra?: () => void,
      ): boolean => {
        if (aborted) return true;
        const reason = postfilter.pushDelta(delta);
        if (reason === 'ok') return false;
        aborted = true;
        streamRef.current?.abort();
        streamRef.current = null;
        chunker.cancel();
        speechService.stop();
        const trailer = trailerFor(reason);
        const cleaned = postfilter.getCleanedText();
        const body = trailer ? `${cleaned}\n\n${trailer}` : cleaned;
        chatStore.replaceGuideText(guideId, body.trim());
        const durationMs = Date.now() - start;
        chatStore.finalizeGuideMessage(guideId, durationMs);
        devicePerf.recordStream(deltaCount, durationMs);
        onDoneExtra?.();
        chatStore.setInferring(false);
        onScroll?.();
        return true;
      };

      // Run at end-of-stream (onDone) before finalize. Trims trailing duplicate
      // sentences from natural-finish answers without surfacing any trailer.
      const applyFinalizeTrim = (guideId: string): void => {
        if (aborted) return;
        const { cleanedText, trimmedReason } = postfilter.finalize();
        if (trimmedReason !== null) {
          chatStore.replaceGuideText(guideId, cleanedText);
        }
      };

      return new Promise<void>((resolve) => {
        (async () => {
          try {
            // ── Online routing (text intent only — Decision D: image stays LLM-only) ──
            if (appMode.get() === 'online' && intent !== 'image') {
              // poiTitle: we don't reliably distinguish POI-tap queries from user
              // queries at this layer (location is always GPS/manual, not POI title).
              // Pass null and let resolveTitle fall back to entity-extraction + placeName.
              const decision = await onlineGuideService.decide({
                query,
                context: { poiTitle: null },
                gps: location,
                perfClass: devicePerf.perfClass(),
                budgetMs: 1500,
              });

              if (decision.mode === 'source-first') {
                // Render Wikipedia extract directly — no LLM call.
                // The source attribution lives in the bubble's source pill;
                // don't repeat it as a "From Wikipedia:" prefix in the body.
                const body = decision.sourceFirstText ?? '';
                chatStore.appendGuideToken(guideId, body);
                chatStore.finalizeGuideMessage(guideId, Date.now() - start);
                chatStore.setGuideSource(guideId, 'wikipedia');
                chatStore.setInferring(false);
                onScroll?.();
                resolve();
                return;
              }

              if (decision.mode === 'rag') {
                // Inject Wikipedia extract as reference, run LLM.
                const callbacks = {
                  onToken: (delta: string) => {
                    if (handleAbortIfNeeded(guideId, delta, () => {
                      chatStore.setGuideSource(guideId, 'wikipedia');
                    })) {
                      resolve();
                      return;
                    }
                    chatStore.appendGuideToken(guideId, delta);
                    chunker.push(delta);
                    deltaCount += 1;
                    onScroll?.();
                  },
                  onDone: () => {
                    if (aborted) return;
                    chunker.flush();
                    applyFinalizeTrim(guideId);
                    const durationMs = Date.now() - start;
                    chatStore.finalizeGuideMessage(guideId, durationMs);
                    devicePerf.recordStream(deltaCount, durationMs);
                    chatStore.setGuideSource(guideId, 'wikipedia');
                    streamRef.current = null;
                    chatStore.setInferring(false);
                    onScroll?.();
                    resolve();
                  },
                  onError: (message: string) => {
                    if (aborted) return;
                    chatStore.setGuideError(guideId, message);
                    streamRef.current = null;
                    chatStore.setInferring(false);
                    onScroll?.();
                    resolve();
                  },
                };
                const handle = await localGuideService.askStream(
                  query,
                  location,
                  callbacks,
                  topicRef.current,
                  history,
                  decision.reference ?? undefined
                );
                streamRef.current = handle;
                return;
              }

              // decision.mode === 'llm-only': fall through to normal LLM path with ai-online source.
              // source is already set to 'ai-online' via resolvedSource above.
            }

            // ── Offline or image intent: existing behavior ────────────────────────────
            const callbacks = {
              onToken: (delta: string) => {
                if (handleAbortIfNeeded(guideId, delta)) {
                  resolve();
                  return;
                }
                chatStore.appendGuideToken(guideId, delta);
                chunker.push(delta);
                deltaCount += 1;
                onScroll?.();
              },
              onDone: () => {
                if (aborted) return;
                chunker.flush();
                applyFinalizeTrim(guideId);
                const durationMs = Date.now() - start;
                chatStore.finalizeGuideMessage(guideId, durationMs);
                devicePerf.recordStream(deltaCount, durationMs);
                streamRef.current = null;
                chatStore.setInferring(false);
                onScroll?.();
                resolve();
              },
              onError: (message: string) => {
                if (aborted) return;
                chatStore.setGuideError(guideId, message);
                streamRef.current = null;
                chatStore.setInferring(false);
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
            chatStore.setGuideError(guideId, message);
            streamRef.current = null;
            chatStore.setInferring(false);
            resolve();
          }
        })();
      });
    },
    [onScroll, speakResponsesRef, topicRef]
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
