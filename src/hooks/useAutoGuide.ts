import { useState, useEffect, useCallback, useRef } from 'react';
import { autoGuideService, type AutoGuideEvent } from '../services/AutoGuideService';
import type { GPSContext } from '../services/InferenceService';

export interface AutoGuideState {
  enabled: boolean;
  latestGps: GPSContext | null;
  latestMessage: string | null;
  isSpeaking: boolean;
  error: string | null;
  toggle: () => void;
}

export function useAutoGuide(onNewMessage?: (text: string, gps: GPSContext) => void): AutoGuideState {
  const [enabled, setEnabled] = useState(false);
  const [latestGps, setLatestGps] = useState<GPSContext | null>(null);
  const [latestMessage, setLatestMessage] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const callbackRef = useRef(onNewMessage);
  callbackRef.current = onNewMessage;

  useEffect(() => {
    const handler = (event: AutoGuideEvent) => {
      switch (event.type) {
        case 'location_update':
          if (event.gps) setLatestGps(event.gps);
          break;
        case 'interesting':
          if (event.text) {
            setLatestMessage(event.text);
            if (event.gps) callbackRef.current?.(event.text, event.gps);
          }
          break;
        case 'speaking':
          setIsSpeaking(true);
          break;
        case 'nothing':
          setIsSpeaking(false);
          break;
        case 'error':
          setError(event.text ?? 'Unknown error');
          setIsSpeaking(false);
          break;
      }
    };

    autoGuideService.setListener(handler);
    return () => autoGuideService.setListener(null);
  }, []);

  useEffect(() => {
    if (!isSpeaking) return;
    const timer = setTimeout(() => setIsSpeaking(false), 30_000);
    return () => clearTimeout(timer);
  }, [isSpeaking]);

  const toggle = useCallback(() => {
    if (enabled) {
      autoGuideService.stop();
      setEnabled(false);
      setIsSpeaking(false);
      setError(null);
    } else {
      setEnabled(true);
      setError(null);
      autoGuideService.start().catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to start auto-guide');
        setEnabled(false);
      });
    }
  }, [enabled]);

  return { enabled, latestGps, latestMessage, isSpeaking, error, toggle };
}
