import { Dimensions, Platform } from 'react-native';

// Font family names match @expo-google-fonts exports; fall back to system
// sans if fonts fail to load.
export const Fonts = {
  serif: 'Fraunces_500Medium',
  sans: 'Nunito_500Medium',
  sansSemi: 'Nunito_600SemiBold',
  sansBold: 'Nunito_700Bold',
  sansBlack: 'Nunito_800ExtraBold',
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) as string,
};

export const Type = {
  display:   { fontFamily: Fonts.serif,    fontSize: 44,   lineHeight: 44, letterSpacing: -1.8 },
  h1:        { fontFamily: Fonts.serif,    fontSize: 26,   lineHeight: 30, letterSpacing: -0.52 },
  title:     { fontFamily: Fonts.serif,    fontSize: 17,   lineHeight: 20, letterSpacing: -0.26 },
  poi:       { fontFamily: Fonts.serif,    fontSize: 13,   lineHeight: 17, letterSpacing: -0.13 },
  body:      { fontFamily: Fonts.sans,     fontSize: 13.5, lineHeight: 20 },
  bodySm:    { fontFamily: Fonts.sans,     fontSize: 13,   lineHeight: 20 },
  button:    { fontFamily: Fonts.sansBold, fontSize: 15,   lineHeight: 18, letterSpacing: 0.3 },
  chip:      { fontFamily: Fonts.sansBold, fontSize: 11,   lineHeight: 13 },
  metaUpper: { fontFamily: Fonts.sansBold, fontSize: 10,   lineHeight: 12, letterSpacing: 1.4 },
  hint:      { fontFamily: Fonts.sansSemi, fontSize: 11,   lineHeight: 14 },
};

export const Radii = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 22,
  pill: 999,
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
};

const ios = (
  color: string,
  offset: { width: number; height: number },
  radius: number,
  opacity: number
) => ({
  shadowColor: color,
  shadowOffset: offset,
  shadowOpacity: opacity,
  shadowRadius: radius,
});

export const Shadows = {
  softOutset: {
    ...ios('#B8623A', { width: 3, height: 3 }, 12, 0.12),
    elevation: 2,
  },
  softFloating: {
    ...ios('#B8623A', { width: 0, height: -4 }, 20, 0.18),
    elevation: 8,
  },
  // Active chip / secondary CTA — hard 3D offset.
  chipActiveHard: {
    ...ios('#B8623A', { width: 0, height: 3 }, 0, 1),
    elevation: 3,
  },
  chipActiveHalo: {
    ...ios('#B8623A', { width: 0, height: 5 }, 10, 0.3),
    elevation: 3,
  },
  ctaHard: {
    ...ios('#B8623A', { width: 0, height: 6 }, 0, 1),
    elevation: 4,
  },
  ctaHalo: {
    ...ios('#B8623A', { width: 0, height: 10 }, 20, 0.35),
    elevation: 4,
  },
  orbDepth: {
    ...ios('#B8623A', { width: 0, height: 8 }, 24, 0.25),
    elevation: 6,
  },
  pinDrop: {
    ...ios('#B8623A', { width: 0, height: 3 }, 6, 0.35),
    elevation: 3,
  },
  tabBar: {
    ...ios('#B8623A', { width: 0, height: -4 }, 16, 0.08),
    elevation: 6,
  },
};

export const Motion = {
  pressTranslateY: 3,
  quick: 150,
  base: 250,
  slow: 400,
};

// Responsive sizing helpers. The whole app renders inside a single window so a
// snapshot at module-load time is good enough for static StyleSheet.create
// values; for components that need to react to rotation/foldables, prefer
// `useWindowDimensions()` directly. These exist so that hero blocks,
// sheet/modal heights, image stand-ins, and any other "sized to the screen"
// elements use a percentage-of-screen instead of a hardcoded pixel count and
// therefore work on phones whose height/width differ from the design device.
const _win = Dimensions.get('window');
export const Sizing = {
  /** Viewport width in pixels (snapshot). */
  windowWidth: _win.width,
  /** Viewport height in pixels (snapshot). */
  windowHeight: _win.height,
  /** percent of viewport width as pixels (e.g. vw(50) === half-screen wide). */
  vw: (percent: number) => Math.round((_win.width * percent) / 100),
  /** percent of viewport height as pixels. */
  vh: (percent: number) => Math.round((_win.height * percent) / 100),
};
