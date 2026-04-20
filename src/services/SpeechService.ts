import * as Speech from 'expo-speech';
import { currentSpeechTag } from '../i18n';

let speaking = false;
const queue: string[] = [];

// Narration rate + voice override — exposed via speechService.setRate/setVoice
// and used by every speak() call. Rate clamped to a sensible walking-tour range.
let narrationRate = 0.95;
let narrationVoice: string | undefined;

function speakNext(): void {
  if (speaking) return;
  const next = queue.shift();
  if (next === undefined) return;

  speaking = true;
  Speech.speak(next, {
    language: currentSpeechTag(),
    rate: narrationRate,
    voice: narrationVoice,
    onDone: () => {
      speaking = false;
      speakNext();
    },
    onError: () => {
      speaking = false;
      speakNext();
    },
    onStopped: () => {
      speaking = false;
      // Stop clears the queue; don't auto-continue.
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
    return new Promise<void>((resolve, reject) => {
      speaking = true;
      Speech.speak(text, {
        language: currentSpeechTag(),
        rate: narrationRate,
        voice: narrationVoice,
        onDone: () => {
          speaking = false;
          resolve();
        },
        onError: (err) => {
          speaking = false;
          reject(err);
        },
        onStopped: () => {
          speaking = false;
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
    speakNext();
  },

  stop(): void {
    queue.length = 0;
    Speech.stop();
    speaking = false;
  },

  // Cancel the currently-playing sentence; the next queued sentence (if any)
  // will start automatically.
  skipCurrent(): void {
    Speech.stop();
    speaking = false;
    speakNext();
  },

  // Playback controls — the engine itself has no native pause/resume, but
  // cancelling preserves the queue so resume() plays the next unit.
  pause(): void {
    Speech.stop();
    speaking = false;
  },

  resume(): void {
    speakNext();
  },

  setRate(rate: number): void {
    narrationRate = Math.max(0.5, Math.min(2.0, rate));
  },

  setVoice(voice: string | undefined): void {
    narrationVoice = voice;
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

  get queueLength(): number {
    return queue.length;
  },
};
