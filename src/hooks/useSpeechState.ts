import { useEffect, useState } from 'react';
import { speechService, type SpeechState } from '../services/SpeechService';

// Subscribes to SpeechService state changes so React can reactively show
// playback controls (pause/resume/skip) while the guide is narrating.
export function useSpeechState(): SpeechState {
  const [state, setState] = useState<SpeechState>(() => speechService.getState());
  useEffect(() => speechService.subscribe(setState), []);
  return state;
}
