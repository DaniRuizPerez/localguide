import type * as SpeechModule from 'expo-speech';

type Voice = SpeechModule.Voice;

export interface LabeledVoice {
  voice: Voice;
  label: string;
}

type Gender = 'female' | 'male' | 'unknown';

// Known iOS voice names — the `name` field on an expo-speech Voice reliably
// carries these on Apple platforms, so we can map them to a gender even when
// the identifier alone tells us nothing.
const IOS_FEMALE = new Set([
  'samantha', 'karen', 'susan', 'victoria', 'moira', 'tessa', 'fiona',
  'allison', 'ava', 'kathy', 'nicky', 'serena', 'kyoko', 'mei-jia',
  'ting-ting', 'sin-ji', 'veena', 'yelda', 'zuzana', 'marie', 'amelie',
  'anna', 'ellen', 'laura', 'paulina', 'luciana', 'monica', 'lekha',
  'milena', 'yuna', 'audrey', 'catherine', 'joelle', 'zoe',
]);
const IOS_MALE = new Set([
  'alex', 'tom', 'daniel', 'fred', 'aaron', 'arthur', 'albert',
  'nicolas', 'thomas', 'xander', 'yuri', 'maged', 'diego',
  'jorge', 'juan', 'rishi', 'hattori', 'otoya', 'ralph',
  'markus', 'rocko', 'grandpa',
]);

/**
 * Best-effort gender inference for a TTS voice. Returns 'unknown' when we
 * can't be sure — which is the common case on Android, where identifiers
 * like `en-us-x-iol-local` give no signal at all. When it IS confident we
 * use the answer to keep male / female labels accurate.
 *
 * Signals we check:
 *   1. `#female` / `#male` / `_female` / `_male` tokens embedded in the
 *      identifier (Google's network voices follow this pattern).
 *   2. The `name` field against a known catalog of iOS voice names.
 */
export function inferGender(voice: Voice): Gender {
  const id = voice.identifier.toLowerCase();
  // Match `female` / `male` preceded by a separator (#/_/-/start) and not
  // followed by another letter. The `\b` shortcut fails here because `_` is
  // a word-char, so `#female_1` has no \b between `female` and `_`.
  // Check female first so `#female` isn't misread as a male hit.
  if (/(^|[#_-])female(?![a-z])/.test(id)) return 'female';
  if (/(^|[#_-])male(?![a-z])/.test(id)) return 'male';

  const name = (voice.name ?? '').toLowerCase();
  if (IOS_FEMALE.has(name)) return 'female';
  if (IOS_MALE.has(name)) return 'male';

  return 'unknown';
}

/**
 * Assign descriptive labels to a list of TTS voices:
 *   - When we can infer gender, the label says so: "Female", "Male 2",
 *     "Female · Enhanced".
 *   - When we can't, we fall back to "Voice" with a counter.
 *   - When only one voice of a given gender/bucket exists, the counter is
 *     dropped so the label reads as "Female" rather than "Female 1".
 *
 * The voices are sorted by identifier first so a given device always shows
 * the same voice under the same label across launches.
 */
export function humanizeVoices(voices: Voice[]): LabeledVoice[] {
  const sorted = [...voices].sort((a, b) => a.identifier.localeCompare(b.identifier));

  // First pass: count voices per bucket so we know whether to append a number.
  const totals: Record<Gender, number> = { female: 0, male: 0, unknown: 0 };
  const genders = sorted.map((v) => {
    const g = inferGender(v);
    totals[g] += 1;
    return g;
  });

  // Second pass: build labels, incrementing per-bucket counters in order.
  const counters: Record<Gender, number> = { female: 0, male: 0, unknown: 0 };
  return sorted.map((voice, i) => {
    const gender = genders[i];
    counters[gender] += 1;
    const baseWord =
      gender === 'female' ? 'Female' : gender === 'male' ? 'Male' : 'Voice';
    const withNumber =
      totals[gender] > 1 ? `${baseWord} ${counters[gender]}` : baseWord;
    const label = voice.quality === 'Enhanced' ? `${withNumber} · Enhanced` : withNumber;
    return { voice, label };
  });
}
