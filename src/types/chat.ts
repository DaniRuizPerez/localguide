import type { GPSContext } from '../services/InferenceService';

export interface Message {
  id: string;
  role: 'user' | 'guide';
  text: string;
  imageUri?: string;
  locationUsed?: GPSContext | string;
  durationMs?: number;
}
