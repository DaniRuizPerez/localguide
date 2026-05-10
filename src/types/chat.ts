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
  // Subject anchor for follow-up turns. Tri-state:
  //   string    — this turn is explicitly about a named POI (set by POI taps,
  //               itinerary stops, proximity narration). Inherited by later
  //               pronoun-only follow-ups ("its history", "tell me more").
  //   null      — explicit reset (e.g. "Tell me about this area" chip, image
  //               attachments). Beats older POI tags during inheritance walk.
  //   undefined — no signal; fall back to inheritance / live cue inference at
  //               stream time. Set this for free-typed text and voice transcripts.
  subjectPoi?: string | null;
}
