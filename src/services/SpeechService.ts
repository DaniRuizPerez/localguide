import * as Speech from 'expo-speech';

let speaking = false;

export const speechService = {
  async speak(text: string): Promise<void> {
    if (speaking) {
      Speech.stop();
    }
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

  stop(): void {
    Speech.stop();
    speaking = false;
  },

  get isSpeaking(): boolean {
    return speaking;
  },
};
