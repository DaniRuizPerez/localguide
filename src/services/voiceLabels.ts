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
 * Curate a small, diverse subset of voices to show in the picker. Android
 * devices commonly expose 40–60 voices for a locale — showing all of them
 * overwhelms the user, and most are near-duplicates (same speaker, different
 * network-vs-local quality tier).
 *
 * Algorithm:
 *   1. Group by (gender, exact language tag). `en-US female`, `en-GB male`,
 *      `en-US unknown`, … each form a bucket.
 *   2. Within each bucket, sort by quality (Enhanced first) then identifier
 *      for stability.
 *   3. Round-robin across buckets: first pick one voice from each distinct
 *      bucket (maximum diversity), then a second voice from each bucket that
 *      has more, and so on until we hit `max` picks.
 *   4. Buckets are ordered so that known-gender combinations come before
 *      unknown, and locale is alphabetical for stability.
 */
export function pickDiverseVoices(voices: Voice[], max: number = 5): Voice[] {
  if (voices.length <= max) return voices;

  const buckets = new Map<string, Voice[]>();
  for (const v of voices) {
    const key = `${inferGender(v)}|${v.language ?? ''}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(v);
    else buckets.set(key, [v]);
  }

  // Sort each bucket so the "best" voice in that bucket is first: Enhanced
  // quality wins; tie-break by identifier for deterministic output.
  for (const vs of buckets.values()) {
    vs.sort((a, b) => {
      const ae = a.quality === 'Enhanced' ? 0 : 1;
      const be = b.quality === 'Enhanced' ? 0 : 1;
      if (ae !== be) return ae - be;
      return a.identifier.localeCompare(b.identifier);
    });
  }

  // Order buckets: known gender before unknown, then alphabetical key.
  const orderedBuckets = [...buckets.entries()]
    .map(([key, vs]) => {
      const [gender, locale] = key.split('|');
      return { key, gender, locale, vs };
    })
    .sort((a, b) => {
      const aKnown = a.gender === 'unknown' ? 1 : 0;
      const bKnown = b.gender === 'unknown' ? 1 : 0;
      if (aKnown !== bKnown) return aKnown - bKnown;
      if (a.locale !== b.locale) return a.locale.localeCompare(b.locale);
      return a.key.localeCompare(b.key);
    });

  const picked: Voice[] = [];
  let round = 0;
  while (picked.length < max) {
    let addedThisRound = false;
    for (const bucket of orderedBuckets) {
      if (picked.length >= max) break;
      if (bucket.vs.length > round) {
        picked.push(bucket.vs[round]);
        addedThisRound = true;
      }
    }
    if (!addedThisRound) break;
    round += 1;
  }

  return picked;
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
