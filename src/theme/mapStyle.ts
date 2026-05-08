// Google Maps custom styles for the "Soft Tactile" direction.
// Light: muted cream. Dark: warm charcoal.
//
// Like colors.ts, the style is chosen ONCE at module load based on the system
// color scheme. Live toggling (without app restart) is deferred to v1.1.
import { Appearance } from 'react-native';

// ─── Light (original cream style) ───────────────────────────────────────────
const softTactileMapStyleLight = [
  { elementType: 'geometry', stylers: [{ color: '#F5EBDF' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8A7260' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#F5EBDF' }] },
  {
    featureType: 'administrative',
    elementType: 'geometry',
    stylers: [{ visibility: 'off' }],
  },
  // Tile POIs are free to render via the Maps SDK. Hide noisy commercial
  // categories (cafes/shops — low Wikipedia hit rate, high visual noise) but
  // expose the categories where Wikipedia coverage is good — those become
  // tappable via onPoiClick in MapScreen and pipe through wikipediaService.
  { featureType: 'poi.business', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business', elementType: 'labels.text', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.attraction', elementType: 'labels.icon', stylers: [{ visibility: 'on' }] },
  { featureType: 'poi.park', elementType: 'labels.icon', stylers: [{ visibility: 'on' }] },
  { featureType: 'poi.place_of_worship', elementType: 'labels.icon', stylers: [{ visibility: 'on' }] },
  { featureType: 'poi.school', elementType: 'labels.icon', stylers: [{ visibility: 'on' }] },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: '#C6DBB5' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#4E6B3B' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#E8D5BE' }],
  },
  {
    featureType: 'road',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#8A7260' }],
  },
  {
    featureType: 'road.arterial',
    elementType: 'geometry',
    stylers: [{ color: '#E8D5BE' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#E0CDB0' }],
  },
  {
    featureType: 'transit',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#BFD6E0' }],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#6B8894' }],
  },
];

// ─── Dark (warm charcoal style) ──────────────────────────────────────────────
const softTactileMapStyleDark = [
  { elementType: 'geometry', stylers: [{ color: '#221C16' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#B5A899' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1A1612' }] },
  {
    featureType: 'administrative',
    elementType: 'geometry',
    stylers: [{ visibility: 'off' }],
  },
  // Same POI visibility rules as light — keep tappable categories exposed.
  { featureType: 'poi.business', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business', elementType: 'labels.text', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.attraction', elementType: 'labels.icon', stylers: [{ visibility: 'on' }] },
  { featureType: 'poi.park', elementType: 'labels.icon', stylers: [{ visibility: 'on' }] },
  { featureType: 'poi.place_of_worship', elementType: 'labels.icon', stylers: [{ visibility: 'on' }] },
  { featureType: 'poi.school', elementType: 'labels.icon', stylers: [{ visibility: 'on' }] },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: '#253320' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#7BAF72' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#302820' }],
  },
  {
    featureType: 'road',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#B5A899' }],
  },
  {
    featureType: 'road.arterial',
    elementType: 'geometry',
    stylers: [{ color: '#302820' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#3A3128' }],
  },
  {
    featureType: 'transit',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#1A2A32' }],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#4A6878' }],
  },
];

// Chosen once at module load. To switch, force-quit + reopen the app.
export const softTactileMapStyle =
  Appearance.getColorScheme() === 'dark'
    ? softTactileMapStyleDark
    : softTactileMapStyleLight;
