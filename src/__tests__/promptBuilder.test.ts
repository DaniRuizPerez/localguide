/**
 * Tests for the narrator-prompt builder. Replaces the string-concat chain
 * that used to live in each LocalGuideService prompt function.
 */

import { buildNarratorPrompt, formatCoordinates } from '../services/promptBuilder';

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
