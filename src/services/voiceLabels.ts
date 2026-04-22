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
 *   - With a language tag + known gender: "en-US female", "en-GB male".
 *   - With a language tag, unknown gender: "en-US voice".
 *   - No language tag but known gender: "Female", "Male" (capitalised).
 *   - No language tag, unknown gender: "Voice".
 *   - When more than one voice shares a (locale, gender) bucket, a numeric
 *     suffix disambiguates: "en-US female 1", "en-US female 2".
 *   - Enhanced-quality voices append "· Enhanced".
 *
 * The voices are sorted by identifier first so a given device always shows
 * the same voice under the same label across launches.
 */
export function humanizeVoices(voices: Voice[]): LabeledVoice[] {
  const sorted = [...voices].sort((a, b) => a.identifier.localeCompare(b.identifier));

  const bucketKey = (v: Voice): string => `${v.language ?? ''}|${inferGender(v)}`;

  // First pass: count voices per bucket so we know whether to append a number.
  const totals = new Map<string, number>();
  for (const v of sorted) {
    const k = bucketKey(v);
    totals.set(k, (totals.get(k) ?? 0) + 1);
  }

  // Second pass: build labels, incrementing per-bucket counters in order.
  const counters = new Map<string, number>();
  return sorted.map((voice) => {
    const k = bucketKey(voice);
    const n = (counters.get(k) ?? 0) + 1;
    counters.set(k, n);

    const locale = voice.language ?? '';
    const gender = inferGender(voice);
    const base = formatBase(locale, gender);
    const total = totals.get(k) ?? 1;
    const withNumber = total > 1 ? `${base} ${n}` : base;
    const label = voice.quality === 'Enhanced' ? `${withNumber} · Enhanced` : withNumber;
    return { voice, label };
  });
}

/**
 * Format the descriptive base label for a (locale, gender) combination.
 * Locale prefix keeps its BCP-47 casing; the gender word is lowercase
 * after it ("en-US female") or capitalised on its own ("Female").
 */
function formatBase(locale: string, gender: Gender): string {
  const genderLower = gender === 'female' ? 'female' : gender === 'male' ? 'male' : 'voice';
  if (locale) {
    return `${locale} ${genderLower}`;
  }
  return genderLower.charAt(0).toUpperCase() + genderLower.slice(1);
}
