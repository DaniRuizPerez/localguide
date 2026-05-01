import type { GPSContext } from '../services/InferenceService';
import type { Source } from '../components/SourceBadge';

export interface Message {
  id: string;
  role: 'user' | 'guide';
  text: string;
  imageUri?: string;
  locationUsed?: GPSContext | string;
  durationMs?: number;
  // Set by Wave 2 features (RAG, timeline, quiz, photo-identify, itinerary).
  // Left undefined until those callers land.
  source?: Source;
}
