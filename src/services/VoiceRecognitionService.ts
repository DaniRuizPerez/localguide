import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import type { IVoiceRecognitionService } from '../types/services';

export const voiceRecognitionService: IVoiceRecognitionService = {
  async requestPermission(): Promise<boolean> {
    const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return granted;
  },

  start(): void {
    ExpoSpeechRecognitionModule.start({
      lang: 'en-US',
      interimResults: false,
      continuous: false,
    });
  },

  stop(): void {
    ExpoSpeechRecognitionModule.stop();
  },

  abort(): void {
    ExpoSpeechRecognitionModule.abort();
  },

  async isAvailable(): Promise<boolean> {
    try {
      await ExpoSpeechRecognitionModule.getPermissionsAsync();
      return true;
    } catch {
      return false;
    }
  },
};
