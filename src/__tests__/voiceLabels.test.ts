import { humanizeVoices } from '../services/voiceLabels';

type Voice = Parameters<typeof humanizeVoices>[0] extends Array<infer V> ? V : never;

function voice(identifier: string, extras: Partial<Voice> = {}): Voice {
  return {
    identifier,
    name: identifier,
    language: 'en-US',
    // VoiceQuality is an enum in expo-speech — use the string literal for
    // tests so we don't need to import the native module.
    quality: 'Default' as Voice['quality'],
    ...extras,
  };
}

describe('humanizeVoices', () => {
  it('returns an empty list for no voices', () => {
    expect(humanizeVoices([])).toEqual([]);
  });

  it('assigns Alex first, Riley second, Sam third (alphabetical by identifier)', () => {
    const labels = humanizeVoices([
      voice('en-us-x-iol-local'),
      voice('en-us-x-sfg-local'),
      voice('en-us-x-aaa-local'),
    ]).map((lv) => lv.label);
    // Sorted by identifier: aaa → Alex, iol → Riley, sfg → Sam.
    expect(labels).toEqual(['Alex', 'Riley', 'Sam']);
  });

  it('is deterministic — same input gives same labels across calls', () => {
    const voices = [
      voice('voice-a'),
      voice('voice-b'),
      voice('voice-c'),
    ];
    const a = humanizeVoices(voices).map((lv) => lv.label);
    const b = humanizeVoices(voices).map((lv) => lv.label);
    expect(a).toEqual(b);
  });

  it('appends "· Enhanced" when a voice is marked Enhanced', () => {
    const [labeled] = humanizeVoices([
      voice('en-us-x-premium-local', { quality: 'Enhanced' as Voice['quality'] }),
    ]);
    expect(labeled.label).toBe('Alex · Enhanced');
  });

  it('cycles with a trailing number when there are more voices than names', () => {
    const voices: Voice[] = [];
    for (let i = 0; i < 18; i += 1) {
      // Identifier prefixed with zero-padded index keeps sort order stable.
      voices.push(voice(`v${String(i).padStart(3, '0')}`));
    }
    const labels = humanizeVoices(voices).map((lv) => lv.label);
    expect(labels[0]).toBe('Alex');
    expect(labels[15]).toBe('Avery');
    expect(labels[16]).toBe('Alex 2');
    expect(labels[17]).toBe('Riley 2');
  });

  it('preserves the voice reference alongside the label', () => {
    const v = voice('en-us-x-aaa-local');
    const [labeled] = humanizeVoices([v]);
    expect(labeled.voice).toBe(v);
  });

  it('does not mutate the input array', () => {
    const input = [voice('b'), voice('a'), voice('c')];
    const copy = [...input];
    humanizeVoices(input);
    expect(input).toEqual(copy);
  });
});
