// "Soft Tactile" palette for Local Guide.
// Warm peach + cream claymorphic direction (light) and warm charcoal (dark).
//
// Live toggling (responding to a system theme change without app restart) is
// intentionally deferred — it would require migrating every StyleSheet.create
// to a hook (v1.1 refactor). For v1.0 we pick the palette ONCE at module load
// based on the system color scheme. To switch themes the user force-quits and
// reopens the app.
import { Appearance } from 'react-native';

const LIGHT_PALETTE = {
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

const DARK_PALETTE = {
  // ─── Brand ─────────────────────────────────────────────
  // Keep hue; bump brightness for readable contrast on dark backgrounds.
  primary: '#F09972',
  primaryLight: '#3D2318',
  primaryDark: '#C8723C',

  // ─── Secondary (sage) ──────────────────────────────────
  secondary: '#7BAF92',
  secondaryLight: '#1E2E26',

  // ─── Neutrals (warm charcoal scale) ───────────────────
  // Primary bg: warm near-black; surface/card slightly lighter; elevated higher.
  background: '#1A1612',
  surface: '#251F18',
  surfaceAlt: '#2E271E',
  border: '#3A3128',
  borderLight: '#2E2720',

  // ─── Text ──────────────────────────────────────────────
  text: '#EDE6DD',
  textPrimary: '#EDE6DD',
  textSecondary: '#B5A899',
  textTertiary: '#7D726A',

  // ─── Status ────────────────────────────────────────────
  success: '#5EC285',
  successLight: '#172A1F',
  error: '#E05C5C',
  errorLight: '#2E1616',
  warning: '#F0B85E',
  warningLight: '#2E2210',

  // ─── Map overlays ──────────────────────────────────────
  // Dark-tinted neutrals matching the soft-tactile charcoal aesthetic.
  mapBackground: '#221C16',
  mapPark: '#253320',
  mapWater: '#1A2A32',
  mapStreet: '#302820',
  mapParkLabel: '#7BAF72',

  // ─── Legacy aliases (keep existing imports working) ────
  userBubble: '#F09972',
  userBubbleText: '#FFFFFF',
  guideBubble: '#251F18',
  guideBubbleText: '#EDE6DD',
  guideBubbleBorder: '#3A3128',
  tabActive: '#F09972',
  tabInactive: '#7D726A',
  tabBar: '#1A1612',
  disabled: '#2E271E',
  disabledText: '#7D726A',
  micActive: '#E05C5C',
  micInactive: '#2E271E',

  white: '#FFFFFF',
  black: '#000000',
} as const;

const scheme = Appearance.getColorScheme();
export const Colors = scheme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;
