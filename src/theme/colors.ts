// "Soft Tactile" palette for Local Guide.
// Warm peach + cream claymorphic direction.
export const Colors = {
  // ─── Brand ─────────────────────────────────────────────
  primary: '#E8845C',
  primaryLight: '#FBE4D7',
  primaryDark: '#B8623A',

  // ─── Secondary (sage) ──────────────────────────────────
  secondary: '#6B8E7A',
  secondaryLight: '#DDE8DF',

  // ─── Neutrals (warm cream scale) ───────────────────────
  background: '#F5E8D8',
  surface: '#FFF7EB',
  surfaceAlt: '#EBDCC4',
  border: '#E0CDB0',
  borderLight: '#EFE0C5',

  // ─── Text ──────────────────────────────────────────────
  text: '#3D2B1F',
  textPrimary: '#3D2B1F',
  textSecondary: '#8A7260',
  textTertiary: '#BFA890',

  // ─── Status ────────────────────────────────────────────
  success: '#4EA374',
  successLight: '#DDE8DF',
  error: '#C64646',
  errorLight: '#F6D8D8',
  warning: '#E8A84E',
  warningLight: '#FBEBD0',

  // ─── Map overlays ──────────────────────────────────────
  mapBackground: '#F5EBDF',
  mapPark: '#C6DBB5',
  mapWater: '#BFD6E0',
  mapStreet: '#E8D5BE',
  mapParkLabel: '#4E6B3B',

  // ─── Legacy aliases (keep existing imports working) ────
  userBubble: '#E8845C',
  userBubbleText: '#FFFFFF',
  guideBubble: '#FFF7EB',
  guideBubbleText: '#3D2B1F',
  guideBubbleBorder: '#EFE0C5',
  tabActive: '#E8845C',
  tabInactive: '#BFA890',
  tabBar: '#FFF7EB',
  disabled: '#EBDCC4',
  disabledText: '#BFA890',
  micActive: '#C64646',
  micInactive: '#EBDCC4',

  white: '#FFFFFF',
  black: '#000000',
} as const;
