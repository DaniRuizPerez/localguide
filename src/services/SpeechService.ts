import * as Speech from 'expo-speech';

let speaking = false;
const queue: string[] = [];

function speakNext(): void {
  if (speaking) return;
  const next = queue.shift();
  if (next === undefined) return;

  speaking = true;
  Speech.speak(next, {
    language: 'en-US',
    rate: 0.95,
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
        language: 'en-US',
        rate: 0.95,
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

  get isSpeaking(): boolean {
    return speaking || queue.length > 0;
  },
};