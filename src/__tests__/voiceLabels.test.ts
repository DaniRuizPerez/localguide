import { humanizeVoices, inferGender } from '../services/voiceLabels';

type Voice = Parameters<typeof humanizeVoices>[0] extends Array<infer V> ? V : never;

function voice(identifier: string, extras: Partial<Voice> = {}): Voice {
  return {
    identifier,
    name: identifier,
    language: 'en-US',
    // VoiceQuality is an enum in expo-speech — pass the string literal so
    // the test doesn't need to import the native module.
    quality: 'Default' as Voice['quality'],
    ...extras,
  };
}

describe('inferGender', () => {
  it('detects #female and #male tokens in the identifier', () => {
    expect(inferGender(voice('en-us-x-sfg#female_1-network'))).toBe('female');
    expect(inferGender(voice('en-us-x-iol#male_2-network'))).toBe('male');
  });

  it('detects _female and _male tokens in the identifier', () => {
    expect(inferGender(voice('some-voice_female'))).toBe('female');
    expect(inferGender(voice('some-voice_male'))).toBe('male');
  });

  it('recognizes known iOS voice names', () => {
    expect(inferGender(voice('com.apple.samantha', { name: 'Samantha' }))).toBe('female');
    expect(inferGender(voice('com.apple.alex', { name: 'Alex' }))).toBe('male');
    expect(inferGender(voice('com.apple.daniel', { name: 'Daniel' }))).toBe('male');
  });

  it('returns "unknown" for opaque identifiers with no hint', () => {
    expect(inferGender(voice('en-us-x-iol-local', { name: 'en-us-x-iol-local' }))).toBe('unknown');
  });
});

describe('humanizeVoices', () => {
  it('returns an empty list for no voices', () => {
    expect(humanizeVoices([])).toEqual([]);
  });

  it('labels a single opaque voice as "Voice" (no number needed)', () => {
    expect(humanizeVoices([voice('en-us-x-iol-local')]).map((l) => l.label)).toEqual(['Voice']);
  });

  it('numbers multiple opaque voices as Voice 1, 2, 3 …', () => {
    const labels = humanizeVoices([
      voice('en-us-x-iol-local'),
      voice('en-us-x-sfg-local'),
      voice('en-us-x-aaa-local'),
    ]).map((l) => l.label);
    expect(labels).toEqual(['Voice 1', 'Voice 2', 'Voice 3']);
  });

  it('labels known-gender voices as Female / Male', () => {
    const labels = humanizeVoices([
      voice('en-us-x-sfg#female_1-network'),
      voice('en-us-x-iol#male_1-network'),
    ]).map((l) => l.label);
    // Sorted by identifier: iol (male) comes before sfg (female).
    expect(labels).toEqual(['Male', 'Female']);
  });

  it('numbers per-gender when there are multiples', () => {
    const labels = humanizeVoices([
      voice('a-male'),
      voice('b-female'),
      voice('c-male'),
      voice('d-female'),
      voice('e-female'),
    ]).map((l) => l.label);
    expect(labels).toEqual(['Male 1', 'Female 1', 'Male 2', 'Female 2', 'Female 3']);
  });

  it('keeps Female / Male buckets separate from Voice (unknown)', () => {
    const labels = humanizeVoices([
      voice('en-us-x-iol-local'),
      voice('en-us-x-sfg#female_1-network'),
      voice('en-us-x-zzz-local'),
    ]).map((l) => l.label);
    // iol (unknown) → Voice 1, sfg (female) → Female, zzz (unknown) → Voice 2.
    expect(labels).toEqual(['Voice 1', 'Female', 'Voice 2']);
  });

  it('appends "· Enhanced" when a voice is marked Enhanced', () => {
    const [labeled] = humanizeVoices([
      voice('en-us-x-sfg#female_1-network', {
        quality: 'Enhanced' as Voice['quality'],
      }),
    ]);
    expect(labeled.label).toBe('Female · Enhanced');
  });

  it('is deterministic — same input gives same labels across calls', () => {
    const voices = [voice('a-female'), voice('b-male'), voice('c-female')];
    const a = humanizeVoices(voices).map((l) => l.label);
    const b = humanizeVoices(voices).map((l) => l.label);
    expect(a).toEqual(b);
  });

  it('preserves the voice reference alongside the label', () => {
    const v = voice('en-us-x-aaa-local');
    const [labeled] = humanizeVoices([v]);
    expect(labeled.voice).toBe(v);
  });

  it('does not mutate the input array', () => {
    const input = [voice('b-male'), voice('a-female'), voice('c-female')];
    const copy = [...input];
    humanizeVoices(input);
    expect(input).toEqual(copy);
  });
});
