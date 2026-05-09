import type { Poi } from './PoiService';
import type { GuideTopic } from './LocalGuideService';

// Single source of truth for "what kind of place is this" — the chip-row
// emoji classifier in HomeState used to keep this regex tree inline, but we
// now also need the same categorization to (a) drive the topic filter in
// settings and (b) keep the emoji and topic in sync when the keyword list
// evolves. Keep the regex order: more specific keywords first so a "Royal
// Opera House" lands on `theater` rather than `building`.

export type PoiCategory =
  | 'mountain' | 'water' | 'beach' | 'forest' | 'park'
  | 'church' | 'mosque' | 'synagogue' | 'temple'
  | 'museum' | 'theater' | 'cinema' | 'library' | 'university' | 'school'
  | 'castle' | 'monument' | 'statue' | 'tower' | 'bridge'
  | 'civic' | 'post' | 'police' | 'fire'
  | 'neighborhood' | 'street'
  | 'restaurant' | 'cafe' | 'bar' | 'market' | 'hotel' | 'shopping'
  | 'transit_rail' | 'transit_air' | 'transit_water'
  | 'stadium' | 'zoo' | 'hospital'
  | 'skyscraper' | 'building'
  | 'unknown';

export const CATEGORY_EMOJI: Record<PoiCategory, string> = {
  mountain: '⛰', water: '🌊', beach: '🏖', forest: '🌲', park: '🌳',
  church: '⛪', mosque: '🕌', synagogue: '🕍', temple: '🛕',
  museum: '🎨', theater: '🎭', cinema: '🎬', library: '📚', university: '🎓', school: '🏫',
  castle: '🏰', monument: '🗿', statue: '🗽', tower: '🗼', bridge: '🌉',
  civic: '🏛', post: '🏤', police: '🚔', fire: '🚒',
  neighborhood: '🏘', street: '🛣',
  restaurant: '🍽', cafe: '☕', bar: '🍻', market: '🧺', hotel: '🏨', shopping: '🛍',
  transit_rail: '🚉', transit_air: '✈️', transit_water: '⚓',
  stadium: '🏟', zoo: '🦁', hospital: '🏥',
  skyscraper: '🏙', building: '🏛',
  unknown: '📍',
};

// Each granular category collapses into one of the 5 high-level GuideTopic
// buckets the user picks in settings. `null` means "topic-agnostic" — those
// POIs (hotels, transit, generic buildings, unclassified) survive any topic
// filter so we don't surprise the user with an empty list when their pick
// happens to miss the current neighborhood's main category.
export const CATEGORY_TO_TOPIC: Record<PoiCategory, GuideTopic | null> = {
  // nature: landscape + wildlife
  mountain: 'nature', water: 'nature', beach: 'nature', forest: 'nature', park: 'nature',
  zoo: 'nature',
  // history: religious/monumental architecture, castles, statues, civic landmarks
  church: 'history', mosque: 'history', synagogue: 'history', temple: 'history',
  castle: 'history', monument: 'history', statue: 'history', tower: 'history', bridge: 'history',
  civic: 'history',
  // culture: museums, performance, learning, sport
  museum: 'culture', theater: 'culture', cinema: 'culture', library: 'culture',
  university: 'culture', school: 'culture', stadium: 'culture',
  // food: restaurants, cafes, bars, markets
  restaurant: 'food', cafe: 'food', bar: 'food', market: 'food',
  // geography: how the place is laid out
  neighborhood: 'geography', street: 'geography',
  // topic-agnostic — always passes the filter
  post: null, police: null, fire: null,
  hotel: null, shopping: null,
  transit_rail: null, transit_air: null, transit_water: null,
  hospital: null,
  skyscraper: null, building: null,
  unknown: null,
};

export function categorizePoi(poi: Poi): PoiCategory {
  const text = `${poi.title} ${poi.description ?? ''}`.toLowerCase();

  if (/\b(mountain|peak|summit|hill|volcano|canyon|valley|cliff)\b/.test(text)) return 'mountain';
  if (/\b(river|lake|pond|waterfall|creek|bay|fjord|lagoon)\b/.test(text)) return 'water';
  if (/\b(beach|coast|shore|seaside|island)\b/.test(text)) return 'beach';
  if (/\b(forest|woods?|nature reserve|wildlife|national park)\b/.test(text)) return 'forest';
  if (/\b(park|garden|arboretum|botanical|plaza|square|promenade)\b/.test(text)) return 'park';

  if (/\b(cathedral|basilica|church|chapel|abbey|convent|monastery)\b/.test(text)) return 'church';
  if (/\b(mosque|minaret)\b/.test(text)) return 'mosque';
  if (/\b(synagogue)\b/.test(text)) return 'synagogue';
  if (/\b(temple|shrine|pagoda)\b/.test(text)) return 'temple';

  if (/\b(museum|gallery|exhibit|exhibition)\b/.test(text)) return 'museum';
  if (/\b(theater|theatre|opera|auditorium|concert hall|playhouse)\b/.test(text)) return 'theater';
  if (/\b(cinema|movie theater|film)\b/.test(text)) return 'cinema';
  if (/\b(library|bookstore|archive)\b/.test(text)) return 'library';
  if (/\b(university|college|campus|institute|academy)\b/.test(text)) return 'university';
  if (/\b(school|kindergarten)\b/.test(text)) return 'school';

  if (/\b(castle|fortress|citadel|palace|château)\b/.test(text)) return 'castle';
  if (/\b(monument|memorial|mausoleum|tomb|cemetery)\b/.test(text)) return 'monument';
  if (/\b(statue|sculpture)\b/.test(text)) return 'statue';
  if (/\b(tower|lighthouse|observation deck|belvedere)\b/.test(text)) return 'tower';
  if (/\b(bridge|viaduct|aqueduct)\b/.test(text)) return 'bridge';

  if (/\b(post office)\b/.test(text)) return 'post';
  if (/\b(police (station|headquarters|precinct)|sheriff'?s? office|gendarmerie)\b/.test(text)) return 'police';
  if (/\b(fire (station|department|house)|firehouse)\b/.test(text)) return 'fire';
  if (
    /\bcivic (center|centre|hall|building|campus|auditorium|complex)\b/.test(text) ||
    /\bgovernment (center|centre|building|complex|house|office|offices)\b/.test(text) ||
    /\bmunicipal (hall|building|center|centre|office|offices|complex)\b/.test(text) ||
    /\badministrative (building|center|centre|complex|offices)\b/.test(text) ||
    /\b(city hall|town hall|capitol|parliament|courthouse|embassy|prefecture|consulate|tribunal|ministry)\b/.test(text)
  ) return 'civic';

  if (
    /\b(chinatown|koreatown|japantown|little italy|greektown|barrio)\b/.test(text) ||
    /\b(neighbou?rhood|district|quarter|borough|suburb|arrondissement)\b/.test(text) ||
    /\b(village|hamlet|town|township)\b/.test(text)
  ) return 'neighborhood';
  if (
    /\b(street|road|avenue|boulevard|lane|alley|drive|way|highway|route)\b/.test(text)
  ) return 'street';

  if (/\b(restaurant|bistro|brasserie|eatery|diner|canteen)\b/.test(text)) return 'restaurant';
  if (/\b(cafe|café|coffee|bakery|patisserie)\b/.test(text)) return 'cafe';
  if (/\b(bar|pub|tavern|brewery|winery|distillery)\b/.test(text)) return 'bar';
  if (/\b(market|bazaar|souk)\b/.test(text)) return 'market';
  if (/\b(hotel|inn|hostel|resort|lodge)\b/.test(text)) return 'hotel';
  if (/\b(shopping|mall|department store|arcade)\b/.test(text)) return 'shopping';

  if (/\b(train station|railway station|metro|subway|terminus)\b/.test(text)) return 'transit_rail';
  if (/\b(airport|aerodrome)\b/.test(text)) return 'transit_air';
  if (/\b(port|harbor|harbour|marina|pier|dock)\b/.test(text)) return 'transit_water';
  if (/\b(stadium|arena|ballpark|velodrome)\b/.test(text)) return 'stadium';
  if (/\b(zoo|aquarium)\b/.test(text)) return 'zoo';
  if (/\b(hospital|clinic)\b/.test(text)) return 'hospital';

  if (/\b(skyscraper|high.?rise|office tower)\b/.test(text)) return 'skyscraper';
  if (/\b(building|house|mansion|villa|estate|hall|pavilion)\b/.test(text)) return 'building';

  return 'unknown';
}

export function poiTopic(poi: Poi): GuideTopic | null {
  return CATEGORY_TO_TOPIC[categorizePoi(poi)];
}

export function poiEmojiFor(poi: Poi): string {
  // GeoNames populated places (PPL, PPLC, PPLA, …) are cities and towns
  // bulk-loaded from cities15000.db. Their titles ("Menlo Park",
  // "Mountain View", "Palo Alto") trip the keyword categorizer (park,
  // mountain, …) and produce misleading emoji on the row. Always show
  // the generic pin for those — no semantic guess from a city name.
  if (poi.source === 'geonames' && poi.featureCode?.startsWith('PPL')) {
    return CATEGORY_EMOJI.unknown;
  }
  return CATEGORY_EMOJI[categorizePoi(poi)];
}

// Topic-agnostic POIs (poiTopic === null) always pass — see CATEGORY_TO_TOPIC
// rationale. 'everything' / empty / undefined → no filtering at all.
export function filterPoisByTopics<T extends Poi>(
  pois: readonly T[],
  topics: readonly GuideTopic[] | undefined
): T[] {
  if (!topics || topics.length === 0 || topics.includes('everything')) {
    return [...pois];
  }
  const set = new Set(topics);
  return pois.filter((p) => {
    const topic = poiTopic(p);
    return topic === null || set.has(topic);
  });
}
