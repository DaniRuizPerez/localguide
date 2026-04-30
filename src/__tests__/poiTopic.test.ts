/**
 * Unit tests for the POI categorizer + topic filter. Pure functions, no IO,
 * so we cover the keyword tree (specific-before-generic ordering, multi-word
 * matches), the category→emoji map, the category→GuideTopic map, and the
 * filterPoisByTopics edge cases (empty topics, "everything", topic-agnostic
 * passes).
 */

import {
  CATEGORY_EMOJI,
  CATEGORY_TO_TOPIC,
  categorizePoi,
  filterPoisByTopics,
  poiEmojiFor,
  poiTopic,
} from '../services/poiTopic';
import type { Poi } from '../services/PoiService';

function makePoi(title: string, description?: string): Poi {
  return {
    pageId: 1,
    title,
    description,
    latitude: 0,
    longitude: 0,
    distanceMeters: 0,
    source: 'wikipedia',
  };
}

describe('categorizePoi', () => {
  it('returns "unknown" for unrecognized titles', () => {
    expect(categorizePoi(makePoi('Zogzog'))).toBe('unknown');
  });

  it('classifies natural features', () => {
    expect(categorizePoi(makePoi('Pikes Peak'))).toBe('mountain');
    expect(categorizePoi(makePoi('Lake Tahoe'))).toBe('water');
    expect(categorizePoi(makePoi('Ocean Beach'))).toBe('beach');
    expect(categorizePoi(makePoi('Muir Woods'))).toBe('forest');
    expect(categorizePoi(makePoi('Central Park'))).toBe('park');
  });

  it('classifies religious sites', () => {
    expect(categorizePoi(makePoi('Notre-Dame Cathedral'))).toBe('church');
    expect(categorizePoi(makePoi('Blue Mosque'))).toBe('mosque');
    expect(categorizePoi(makePoi('Central Synagogue'))).toBe('synagogue');
    expect(categorizePoi(makePoi('Senso-ji Temple'))).toBe('temple');
  });

  it('classifies cultural venues', () => {
    expect(categorizePoi(makePoi('Museum of Modern Art'))).toBe('museum');
    expect(categorizePoi(makePoi('Royal Opera House'))).toBe('theater');
    expect(categorizePoi(makePoi('Stanford University'))).toBe('university');
    expect(categorizePoi(makePoi('Public Library'))).toBe('library');
  });

  it('classifies food / hospitality', () => {
    expect(categorizePoi(makePoi('Joe\'s Restaurant'))).toBe('restaurant');
    expect(categorizePoi(makePoi('Blue Bottle Coffee'))).toBe('cafe');
    expect(categorizePoi(makePoi('The Old Pub'))).toBe('bar');
    expect(categorizePoi(makePoi('Camden Market'))).toBe('market');
    expect(categorizePoi(makePoi('Hotel California'))).toBe('hotel');
  });

  it('classifies transit', () => {
    expect(categorizePoi(makePoi('Grand Central Train Station'))).toBe('transit_rail');
    expect(categorizePoi(makePoi('Heathrow Airport'))).toBe('transit_air');
    expect(categorizePoi(makePoi('Old Port Marina'))).toBe('transit_water');
  });

  it('classifies civic landmarks', () => {
    expect(categorizePoi(makePoi('San Francisco City Hall'))).toBe('civic');
    expect(categorizePoi(makePoi('U.S. Capitol'))).toBe('civic');
    expect(categorizePoi(makePoi('Royal Courts of Justice', 'courthouse in London'))).toBe('civic');
  });

  it('uses description text in addition to the title', () => {
    expect(
      categorizePoi(makePoi('The White Stag', 'historic English pub'))
    ).toBe('bar');
    expect(
      categorizePoi(makePoi('La Sagrada', 'unfinished basilica designed by Gaudí'))
    ).toBe('church');
  });

  it('matches specific keywords before generic ones (theater beats building)', () => {
    expect(categorizePoi(makePoi('Royal Opera House'))).toBe('theater');
    expect(categorizePoi(makePoi('Carnegie Concert Hall'))).toBe('theater');
  });

  it('matches whole words only — "parking" must not classify as park', () => {
    expect(categorizePoi(makePoi('Parking Lot 5'))).not.toBe('park');
  });

  it('falls back to building only when nothing more specific matches', () => {
    expect(categorizePoi(makePoi('Generic House'))).toBe('building');
    expect(categorizePoi(makePoi('Memorial Hall'))).toBe('monument');
  });
});

describe('poiEmojiFor', () => {
  it('returns the emoji configured for the matched category', () => {
    expect(poiEmojiFor(makePoi('Stanford University'))).toBe(CATEGORY_EMOJI.university);
    expect(poiEmojiFor(makePoi('Central Park'))).toBe(CATEGORY_EMOJI.park);
  });

  it('returns the unknown pin for uncategorized POIs', () => {
    expect(poiEmojiFor(makePoi('Zogzog'))).toBe(CATEGORY_EMOJI.unknown);
  });
});

describe('poiTopic', () => {
  it('maps culture categories to "culture"', () => {
    expect(poiTopic(makePoi('Stanford University'))).toBe('culture');
    expect(poiTopic(makePoi('Tate Modern Museum'))).toBe('culture');
  });

  it('maps nature categories to "nature"', () => {
    expect(poiTopic(makePoi('Yosemite Valley'))).toBe('nature');
    expect(poiTopic(makePoi('San Diego Zoo'))).toBe('nature');
  });

  it('maps religious + civic + monumental categories to "history"', () => {
    expect(poiTopic(makePoi('Notre-Dame Cathedral'))).toBe('history');
    expect(poiTopic(makePoi('Edinburgh Castle'))).toBe('history');
    expect(poiTopic(makePoi('U.S. Capitol'))).toBe('history');
  });

  it('returns null for topic-agnostic categories so they always pass filters', () => {
    expect(poiTopic(makePoi('Hilton Hotel'))).toBeNull();
    expect(poiTopic(makePoi('Heathrow Airport'))).toBeNull();
    // The "unknown" bucket is also topic-agnostic by design.
    expect(poiTopic(makePoi('Zogzog'))).toBeNull();
  });
});

describe('CATEGORY_TO_TOPIC', () => {
  it('covers every category — no silently-unmapped buckets', () => {
    for (const category of Object.keys(CATEGORY_EMOJI) as Array<keyof typeof CATEGORY_EMOJI>) {
      expect(CATEGORY_TO_TOPIC).toHaveProperty(category);
    }
  });
});

describe('filterPoisByTopics', () => {
  const restaurant = makePoi('Joe\'s Restaurant');
  const museum = makePoi('Museum of Modern Art');
  const hotel = makePoi('Hilton Hotel'); // topic-agnostic
  const park = makePoi('Central Park');
  const all = [restaurant, museum, hotel, park];

  it('returns a copy of every POI when topics is undefined', () => {
    const out = filterPoisByTopics(all, undefined);
    expect(out).toEqual(all);
    expect(out).not.toBe(all); // copy, not reference
  });

  it('returns every POI when topics is empty', () => {
    expect(filterPoisByTopics(all, [])).toEqual(all);
  });

  it('returns every POI when topics contains "everything"', () => {
    expect(filterPoisByTopics(all, ['everything'])).toEqual(all);
    expect(filterPoisByTopics(all, ['food', 'everything'])).toEqual(all);
  });

  it('filters to the matching topics', () => {
    expect(filterPoisByTopics(all, ['food'])).toEqual([restaurant, hotel]);
    expect(filterPoisByTopics(all, ['culture'])).toEqual([museum, hotel]);
    expect(filterPoisByTopics(all, ['nature'])).toEqual([hotel, park]);
  });

  it('topic-agnostic POIs survive every non-empty filter', () => {
    // Hotel has no topic but never gets filtered out.
    for (const topic of ['food', 'culture', 'history', 'nature', 'geography'] as const) {
      expect(filterPoisByTopics([hotel], [topic])).toEqual([hotel]);
    }
  });

  it('preserves order within the kept subset', () => {
    const ordered = [park, restaurant, museum, hotel];
    expect(filterPoisByTopics(ordered, ['food'])).toEqual([restaurant, hotel]);
    expect(filterPoisByTopics(ordered, ['nature'])).toEqual([park, hotel]);
  });
});
