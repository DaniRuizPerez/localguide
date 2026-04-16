import * as Speech from 'expo-speech';

let speaking = false;
let currentToken = 0;

export const speechService = {
  async speak(text: string): Promise<void> {
    if (speaking) {
      Speech.stop();
    }
    const token = ++currentToken;
    return new Promise<void>((resolve, reject) => {
      speaking = true;
      Speech.speak(text, {
        language: 'en-US',
        rate: 0.95,
        onDone: () => {
          if (token !== currentToken) return;
          speaking = false;
          resolve();
        },
        onError: (err) => {
          if (token !== currentToken) return;
          speaking = false;
          reject(err);
        },
        onStopped: () => {
          if (token !== currentToken) return;
          speaking = false;
          resolve();
        },
      });
    });
  },

  stop(): void {
    Speech.stop();
    speaking = false;
  },

  get isSpeaking(): boolean {
    return speaking;
  },
};
