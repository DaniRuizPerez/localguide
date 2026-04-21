import type * as SpeechModule from 'expo-speech';

type Voice = SpeechModule.Voice;

export interface LabeledVoice {
  voice: Voice;
  label: string;
}

// Gender-neutral first names used to label TTS voices. Android / iOS expose
// opaque identifiers like `en-us-x-iol-local` or `com.apple.ttsbundle.Samantha-compact`,
// neither of which a user can parse. We pick a stable friendly name per voice
// based on its identifier so the list reads as "Alex · Riley · Sam" instead of
// the raw strings. Mapping is deterministic for a given identifier list:
// sorting by identifier first means the same device always shows the same
// names in the same order.
const FRIENDLY_NAMES = [
  'Alex',
  'Riley',
  'Sam',
  'Jordan',
  'Kai',
  'Nova',
  'Sage',
  'Ellis',
  'Morgan',
  'Quinn',
  'Reese',
  'Phoenix',
  'Skylar',
  'Emery',
  'Rowan',
  'Avery',
];

/**
 * Assign intuitive first-name labels to a list of TTS voices. Returns the
 * voices paired with their friendly labels, in a stable order sorted by
 * identifier so a given device always shows the same mapping.
 *
 * For voices whose `quality` is `'Enhanced'`, the label carries a
 * "· Enhanced" suffix so users can prefer higher-quality options without
 * needing to know what the flag means technically.
 *
 * When a device has more voices than the pool has names (rare — most Android
 * devices ship 1–3 locale-matched voices), the pool cycles with a trailing
 * number suffix: Alex, Riley, ..., Avery, Alex 2, Riley 2, ...
 */
export function humanizeVoices(voices: Voice[]): LabeledVoice[] {
  const sorted = [...voices].sort((a, b) => a.identifier.localeCompare(b.identifier));
  return sorted.map((voice, i) => {
    const base = FRIENDLY_NAMES[i % FRIENDLY_NAMES.length];
    const cycle = Math.floor(i / FRIENDLY_NAMES.length);
    const name = cycle === 0 ? base : `${base} ${cycle + 1}`;
    const enhanced = voice.quality === 'Enhanced';
    return { voice, label: enhanced ? `${name} · Enhanced` : name };
  });
}
