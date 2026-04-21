import * as Speech from 'expo-speech';
import { currentSpeechTag } from '../i18n';
import { narrationPrefs } from './NarrationPrefs';

let speaking = false;
let paused = false;
// What's currently being spoken, if any. When the user pauses we re-insert
// this at the head of the queue so resume() restarts the whole sentence
// rather than silently dropping it. expo-speech has no native pause, so
// this "restart-the-current-sentence" model is the best we can do.
let currentUtterance: string | null = null;
const queue: string[] = [];
const listeners = new Set<(state: SpeechState) => void>();

export interface SpeechState {
  isSpeaking: boolean;
  isPaused: boolean;
  queueLength: number;
}

// Narration rate + voice override — exposed via speechService.setRate/setVoice
// and used by every speak() call. Rate clamped to a sensible walking-tour range.
let narrationRate = 0.95;
let narrationVoice: string | undefined;

function snapshot(): SpeechState {
  return {
    isSpeaking: speaking || queue.length > 0,
    isPaused: paused,
    queueLength: queue.length,
  };
}

function notify(): void {
  const s = snapshot();
  for (const l of listeners) l(s);
}

// Bridge user prefs (persisted) → the live TTS options used for every utterance.
// Subscribe once at module load; prefs may hydrate asynchronously so we also pull
// the current snapshot immediately for the common warm-start case.
{
  const applyPrefs = (p: { rate: number; voice: string | undefined }) => {
    narrationRate = Math.max(0.5, Math.min(2.0, p.rate));
    narrationVoice = p.voice;
  };
  applyPrefs(narrationPrefs.get());
  narrationPrefs.subscribe(applyPrefs);
  // Kick off hydration so persisted rate/voice are in effect as soon as they
  // arrive — applyPrefs will be notified through the subscription.
  narrationPrefs.hydrate().catch(() => {});
}

function speakNext(): void {
  if (speaking || paused) return;
  const next = queue.shift();
  if (next === undefined) {
    currentUtterance = null;
    notify();
    return;
  }

  speaking = true;
  currentUtterance = next;
  notify();
  Speech.speak(next, {
    language: currentSpeechTag(),
    rate: narrationRate,
    voice: narrationVoice,
    onDone: () => {
      speaking = false;
      currentUtterance = null;
      speakNext();
    },
    onError: () => {
      speaking = false;
      currentUtterance = null;
      speakNext();
    },
    onStopped: () => {
      speaking = false;
      // Don't auto-continue. The method that called stop() is responsible
      // for deciding whether to drain more (pause: no; skipCurrent: yes).
      notify();
    },
  });
}

export const speechService = {
  /**
   * Speak `text` immediately, cancelling any in-flight speech and clearing the queue.
   */
  async speak(text: string): Promise<void> {
    Speech.stop();
    queue.length = 0;
    speaking = false;
    paused = false;
    currentUtterance = text;
    notify();
    return new Promise<void>((resolve, reject) => {
      speaking = true;
      notify();
      Speech.speak(text, {
        language: currentSpeechTag(),
        rate: narrationRate,
        voice: narrationVoice,
        onDone: () => {
          speaking = false;
          currentUtterance = null;
          notify();
          resolve();
        },
        onError: (err) => {
          speaking = false;
          currentUtterance = null;
          notify();
          reject(err);
        },
        onStopped: () => {
          speaking = false;
          currentUtterance = null;
          notify();
          resolve();
        },
      });
    });
  },

  /**
   * Append `text` to the end of the speech queue. Plays back-to-back with any
   * previously queued items. Use this for streaming chunks (e.g. sentence by
   * sentence) so the voice runs alongside continued text generation.
   */
  enqueue(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    queue.push(trimmed);
    // Adding content implicitly un-pauses — the user clearly wants to hear
    // this (e.g. a new narration was triggered while paused).
    paused = false;
    speakNext();
    notify();
  },

  stop(): void {
    queue.length = 0;
    Speech.stop();
    speaking = false;
    paused = false;
    currentUtterance = null;
    notify();
  },

  // Cancel the currently-playing sentence; the next queued sentence (if any)
  // starts automatically.
  skipCurrent(): void {
    Speech.stop();
    speaking = false;
    currentUtterance = null;
    paused = false;
    notify();
    speakNext();
  },

  // Pause narration. expo-speech has no native pause, so we stop the current
  // utterance and put it back on the front of the queue; resume() replays it
  // from the beginning of that sentence.
  pause(): void {
    if (paused) return;
    if (currentUtterance) {
      queue.unshift(currentUtterance);
      currentUtterance = null;
    }
    paused = true;
    Speech.stop();
    speaking = false;
    notify();
  },

  resume(): void {
    if (!paused) return;
    paused = false;
    notify();
    speakNext();
  },

  setRate(rate: number): void {
    // Route through narrationPrefs so the value persists and notifies other
    // subscribers (e.g. the settings UI). The subscribe callback above writes
    // back into narrationRate.
    narrationPrefs.setRate(rate);
  },

  setVoice(voice: string | undefined): void {
    narrationPrefs.setVoice(voice);
  },

  get rate(): number {
    return narrationRate;
  },

  get voice(): string | undefined {
    return narrationVoice;
  },

  async getAvailableVoices(): Promise<Speech.Voice[]> {
    try {
      return (await Speech.getAvailableVoicesAsync()) ?? [];
    } catch {
      return [];
    }
  },

  get isSpeaking(): boolean {
    return speaking || queue.length > 0;
  },

  get isPaused(): boolean {
    return paused;
  },

  get queueLength(): number {
    return queue.length;
  },

  getState(): SpeechState {
    return snapshot();
  },

  subscribe(listener: (state: SpeechState) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
