import { useState, useCallback, useEffect, useRef } from 'react';
import { useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { voiceRecognitionService } from '../services/VoiceRecognitionService';

export interface VoiceInputState {
  isListening: boolean;
  error: string | null;
  available: boolean;
  startListening: () => void;
  stopListening: () => void;
}

export function useVoiceInput(onResult?: (text: string) => void): VoiceInputState {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);
  const callbackRef = useRef(onResult);
  callbackRef.current = onResult;

  useEffect(() => {
    voiceRecognitionService.isAvailable().then(setAvailable);
  }, []);

  useSpeechRecognitionEvent('result', (event) => {
    if (event.isFinal && event.results?.[0]?.transcript) {
      setIsListening(false);
      callbackRef.current?.(event.results[0].transcript);
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    setError(event.error ?? 'Speech recognition failed');
    setIsListening(false);
  });

  useSpeechRecognitionEvent('end', () => {
    setIsListening(false);
  });

  const startListening = useCallback(async () => {
    setError(null);
    const granted = await voiceRecognitionService.requestPermission();
    if (!granted) {
      setError('Microphone permission denied');
      return;
    }
    setIsListening(true);
    voiceRecognitionService.start();
  }, []);

  const stopListening = useCallback(() => {
    voiceRecognitionService.stop();
    setIsListening(false);
  }, []);

  return { isListening, error, available, startListening, stopListening };
}
