/**
 * Tests for the narrator-prompt builder. Replaces the string-concat chain
 * that used to live in each LocalGuideService prompt function.
 */

import { buildNarratorPrompt, clampToSentence, formatCoordinates } from '../services/promptBuilder';

describe('buildNarratorPrompt', () => {
  it('renders system + cue in the minimal case', () => {
    const p = buildNarratorPrompt({ system: 'You are a guide.', cue: 'Narrate.' });
    expect(p).toBe('You are a guide.\nCue: Narrate.');
  });

  it('appends truthy directives each on their own line', () => {
    const p = buildNarratorPrompt({
      system: 'SYS',
      directives: ['Respond in Spanish.', 'Length: short.'],
      cue: 'Go.',
    });
    expect(p).toBe('SYS\nRespond in Spanish.\nLength: short.\nCue: Go.');
  });

  it('silently drops falsy directives (false / null / undefined / empty string)', () => {
    const p = buildNarratorPrompt({
      system: 'SYS',
      directives: ['keep me', false, null, undefined, '', 'me too'],
      cue: 'Go.',
    });
    expect(p).toBe('SYS\nkeep me\nme too\nCue: Go.');
  });

  it('renders Place line only when location has a name (default behaviour)', () => {
    const withName = buildNarratorPrompt({
      system: 'SYS',
      place: { latitude: 48.8566, longitude: 2.3522, placeName: 'Paris' },
      cue: 'Go.',
    });
    expect(withName).toContain('Place: Paris');
    expect(withName).not.toContain('Coordinates:');

    const noName = buildNarratorPrompt({
      system: 'SYS',
      place: { latitude: 48.8566, longitude: 2.3522 },
      cue: 'Go.',
    });
    expect(noName).not.toContain('Place:');
    expect(noName).toContain('Coordinates: 48.856600, 2.352200');
  });

  it('renders string locations as the Place value directly', () => {
    const p = buildNarratorPrompt({
      system: 'SYS',
      place: 'Stanford campus',
      cue: 'Go.',
    });
    expect(p).toContain('Place: Stanford campus');
  });

  it('omitCoordsWithPlace=false forces the Coordinates line even with a place name', () => {
    const p = buildNarratorPrompt({
      system: 'SYS',
      place: { latitude: 48.8566, longitude: 2.3522, placeName: 'Paris' },
      omitCoordsWithPlace: false,
      cue: 'Go.',
    });
    expect(p).toContain('Place: Paris');
    expect(p).toContain('Coordinates: 48.856600, 2.352200');
  });

  it('inserts extraContext between the location block and the cue', () => {
    const p = buildNarratorPrompt({
      system: 'SYS',
      place: 'Anywhere',
      extraContext: 'Some extra instructions.',
      cue: 'Go.',
    });
    const lines = p.split('\n');
    const placeIdx = lines.indexOf('Place: Anywhere');
    const extraIdx = lines.indexOf('Some extra instructions.');
    const cueIdx = lines.indexOf('Cue: Go.');
    expect(extraIdx).toBeGreaterThan(placeIdx);
    expect(cueIdx).toBeGreaterThan(extraIdx);
  });

  it('omits the Cue line entirely when cue is not provided', () => {
    const p = buildNarratorPrompt({
      system: 'SYS',
      extraContext: 'Do the thing.',
    });
    expect(p).not.toContain('Cue:');
    expect(p.endsWith('Do the thing.')).toBe(true);
  });
});

describe('buildNarratorPrompt — reference block', () => {
  const BASE = { system: 'SYS', place: 'Anywhere', extraContext: 'Extra.', cue: 'Go.' };

  it('renders the Reference block after extraContext and before the cue', () => {
    const p = buildNarratorPrompt({ ...BASE, reference: 'Some ground truth.' });
    const lines = p.split('\n');
    const extraIdx = lines.indexOf('Extra.');
    const refHeaderIdx = lines.indexOf('Reference (use as ground truth — rephrase but never contradict):');
    const refBodyIdx = lines.indexOf('Some ground truth.');
    const cueIdx = lines.indexOf('Cue: Go.');
    expect(refHeaderIdx).toBeGreaterThan(extraIdx);
    expect(refBodyIdx).toBe(refHeaderIdx + 1);
    expect(cueIdx).toBeGreaterThan(refBodyIdx);
  });

  it('passes short reference through unchanged', () => {
    const ref = 'Short sentence.';
    const p = buildNarratorPrompt({ ...BASE, reference: ref });
    expect(p).toContain(ref);
  });

  it('truncates long reference at the last sentence boundary before 600 chars', () => {
    // Build a reference longer than 600 chars with a sentence boundary inside the limit.
    const sentenceA = 'A'.repeat(300) + '.';  // ends at char 301
    const sentenceB = 'B'.repeat(400) + '.';  // total > 600
    const ref = sentenceA + sentenceB;
    expect(ref.length).toBeGreaterThan(600);
    const p = buildNarratorPrompt({ ...BASE, reference: ref });
    // Should contain only sentenceA in the reference block.
    expect(p).toContain(sentenceA);
    expect(p).not.toContain(sentenceB);
  });

  it('hard-cuts with ellipsis when no sentence boundary exists in first 600 chars', () => {
    const ref = 'X'.repeat(700); // no punctuation at all
    const p = buildNarratorPrompt({ ...BASE, reference: ref });
    expect(p).toContain('X'.repeat(600) + '…');
    expect(p).not.toContain('X'.repeat(601));
  });

  it('produces output identical to no-reference case when reference is undefined', () => {
    const withoutRef = buildNarratorPrompt(BASE);
    const withUndefined = buildNarratorPrompt({ ...BASE, reference: undefined });
    expect(withUndefined).toBe(withoutRef);
  });

  it('produces output identical to no-reference case when reference is empty string', () => {
    const withoutRef = buildNarratorPrompt(BASE);
    const withEmpty = buildNarratorPrompt({ ...BASE, reference: '' });
    expect(withEmpty).toBe(withoutRef);
    expect(withEmpty).not.toContain('Reference');
  });
});

describe('clampToSentence', () => {
  it('returns text unchanged when within limit', () => {
    expect(clampToSentence('Hello.', 600)).toBe('Hello.');
  });

  it('trims at the last sentence-ending . before the limit', () => {
    const text = 'First sentence. ' + 'X'.repeat(590) + '.';
    const result = clampToSentence(text, 600);
    expect(result).toBe('First sentence.');
  });

  it('prefers the rightmost boundary among . ! ?', () => {
    // Place a '!' closer to the limit than a '.' so it should be preferred.
    const text = 'Start. Middle! ' + 'Y'.repeat(590);
    const result = clampToSentence(text, 600);
    // 'Middle!' ends at index 14; that is within 600 and is the last boundary.
    expect(result.endsWith('!')).toBe(true);
    expect(result).toBe('Start. Middle!');
  });

  it('hard-cuts with ellipsis when no sentence boundary exists', () => {
    const text = 'A'.repeat(700);
    expect(clampToSentence(text, 600)).toBe('A'.repeat(600) + '…');
  });

  it('returns text unchanged when exactly at limit', () => {
    const text = 'A'.repeat(600);
    expect(clampToSentence(text, 600)).toBe(text);
  });
});

describe('formatCoordinates', () => {
  it('returns string locations verbatim', () => {
    expect(formatCoordinates('Paris')).toBe('Paris');
  });

  it('formats lat/lon to 6 decimals and appends accuracy when present', () => {
    expect(formatCoordinates({ latitude: 48.8566, longitude: 2.3522, accuracy: 7.8 })).toBe(
      '48.856600, 2.352200 (±8m)'
    );
  });

  it('omits accuracy note when absent', () => {
    expect(formatCoordinates({ latitude: 51.5074, longitude: -0.1278 })).toBe(
      '51.507400, -0.127800'
    );
  });
});
