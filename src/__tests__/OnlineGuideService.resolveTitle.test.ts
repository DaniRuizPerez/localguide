/**
 * Table tests for onlineGuideService.resolveTitle().
 * Pure function — no mocks needed.
 */

import { onlineGuideService } from '../services/OnlineGuideService';
import type { GPSContext } from '../services/InferenceService';

const { resolveTitle } = onlineGuideService;

describe('resolveTitle — poiTitle takes priority', () => {
  it('returns context.poiTitle when set', () => {
    const gps: GPSContext = { latitude: 37.4, longitude: -122.1, placeName: 'Palo Alto, California' };
    expect(
      resolveTitle('what is this place?', { poiTitle: 'Stanford Memorial Church' }, gps)
    ).toBe('Stanford Memorial Church');
  });

  it('returns context.poiTitle even when query has its own entity', () => {
    expect(
      resolveTitle('Tell me about the Eiffel Tower', { poiTitle: 'Golden Gate Bridge' }, null)
    ).toBe('Golden Gate Bridge');
  });

  it('returns context.poiTitle when gps is null', () => {
    expect(
      resolveTitle('anything', { poiTitle: 'Alcatraz' }, null)
    ).toBe('Alcatraz');
  });
});

describe('resolveTitle — entity extraction from query', () => {
  it('"Tell me about Stanford Memorial Church" → "Stanford Memorial Church"', () => {
    expect(
      resolveTitle('Tell me about Stanford Memorial Church', {}, null)
    ).toBe('Stanford Memorial Church');
  });

  it('"Painted Ladies in San Francisco" → longest match', () => {
    const result = resolveTitle('Painted Ladies in San Francisco', {}, null);
    // Either "Painted Ladies" or "San Francisco" — both are valid capitalized runs.
    // "San Francisco" is 13 chars, "Painted Ladies" is 14 chars — longest wins.
    expect(result).toBe('Painted Ladies');
  });

  it('"What is the Golden Gate Bridge?" → "Golden Gate Bridge"', () => {
    expect(
      resolveTitle('What is the Golden Gate Bridge?', {}, null)
    ).toBe('Golden Gate Bridge');
  });

  it('"Tell me about Hoover Tower" → "Hoover Tower"', () => {
    expect(
      resolveTitle('Tell me about Hoover Tower', {}, null)
    ).toBe('Hoover Tower');
  });

  it('ignores single-word capitalized words (e.g. first word only)', () => {
    // "What" and "Paris" — "Paris" alone is 1 capitalized word, not ≥ 2.
    const result = resolveTitle("What's the weather?", {}, 'Paris');
    // No 2-word run found, falls back to gps string.
    expect(result).toBe('Paris');
  });

  it('poiTitle empty string does not count — falls through to entity extraction', () => {
    expect(
      resolveTitle('Tell me about Lombard Street', { poiTitle: '' }, null)
    ).toBe('Lombard Street');
  });

  it('poiTitle null does not count — falls through to entity extraction', () => {
    expect(
      resolveTitle('Tell me about Fisherman\'s Wharf', { poiTitle: null }, null)
    ).toBe("Fisherman's Wharf");
  });
});

describe('resolveTitle — gps fallback', () => {
  it('falls back to gps.placeName when no entity in query', () => {
    const gps: GPSContext = { latitude: 37.4, longitude: -122.1, placeName: 'Palo Alto, California' };
    expect(
      resolveTitle("what's nearby?", {}, gps)
    ).toBe('Palo Alto, California');
  });

  it('falls back to gps string when no entity in query', () => {
    expect(
      resolveTitle("what's nearby?", {}, 'Palo Alto, California')
    ).toBe('Palo Alto, California');
  });

  it('returns gps.placeName even when placeName is short', () => {
    const gps: GPSContext = { latitude: 37.4, longitude: -122.1, placeName: 'Rome' };
    expect(
      resolveTitle('recommend something', {}, gps)
    ).toBe('Rome');
  });
});

describe('resolveTitle — null when nothing matches', () => {
  it('returns null when no poiTitle, no entity, no gps', () => {
    expect(resolveTitle('hello', {}, null)).toBeNull();
  });

  it('returns null for generic lowercase query with no gps', () => {
    expect(resolveTitle('what is nearby?', {}, null)).toBeNull();
  });

  it('returns null for empty query with null gps', () => {
    expect(resolveTitle('', {}, null)).toBeNull();
  });

  it('returns null when gps has no placeName and no entity in query', () => {
    const gps: GPSContext = { latitude: 37.4, longitude: -122.1 };
    expect(resolveTitle('recommend something', {}, gps)).toBeNull();
  });

  it('returns null when gps is empty string', () => {
    expect(resolveTitle('hello there', {}, '')).toBeNull();
  });
});
