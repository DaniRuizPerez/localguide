// Muted-cream Google Maps style approximating the Soft Tactile direction.
// Colors match Colors.map* in src/theme/colors.ts.
export const softTactileMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#F5EBDF' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8A7260' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#F5EBDF' }] },
  {
    featureType: 'administrative',
    elementType: 'geometry',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'poi',
    elementType: 'labels.icon',
    stylers: [{ visibility: 'off' }],
  },
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
