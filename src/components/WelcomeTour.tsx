/**
 * WelcomeTour — one-time 4-slide orientation shown after the model download
 * completes and before the user lands on the home screen.
 *
 * Persists @localguide/welcome-seen-v1 in AsyncStorage so the tour appears
 * exactly once per install. Returns null immediately on subsequent launches.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '../theme/colors';
import { Type } from '../theme/tokens';
import { t } from '../i18n';

// ─── Constants ───────────────────────────────────────────────────────────────

export const WELCOME_SEEN_KEY = '@localguide/welcome-seen-v1';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Slide data ──────────────────────────────────────────────────────────────

type Slide = {
  emojiKey:
    | 'welcome.slide1Emoji'
    | 'welcome.slide2Emoji'
    | 'welcome.slide3Emoji'
    | 'welcome.slide4Emoji';
  titleKey:
    | 'welcome.slide1Title'
    | 'welcome.slide2Title'
    | 'welcome.slide3Title'
    | 'welcome.slide4Title';
  bodyKey:
    | 'welcome.slide1Body'
    | 'welcome.slide2Body'
    | 'welcome.slide3Body'
    | 'welcome.slide4Body';
};

const SLIDES: Slide[] = [
  {
    emojiKey: 'welcome.slide1Emoji',
    titleKey: 'welcome.slide1Title',
    bodyKey: 'welcome.slide1Body',
  },
  {
    emojiKey: 'welcome.slide2Emoji',
    titleKey: 'welcome.slide2Title',
    bodyKey: 'welcome.slide2Body',
  },
  {
    emojiKey: 'welcome.slide3Emoji',
    titleKey: 'welcome.slide3Title',
    bodyKey: 'welcome.slide3Body',
  },
  {
    emojiKey: 'welcome.slide4Emoji',
    titleKey: 'welcome.slide4Title',
    bodyKey: 'welcome.slide4Body',
  },
];

// ─── Props ───────────────────────────────────────────────────────────────────

interface WelcomeTourProps {
  /** Called when the user dismisses the tour (Got it / Skip). */
  onDismiss: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function WelcomeTour({ onDismiss }: WelcomeTourProps): React.ReactElement | null {
  // null = still checking AsyncStorage; true = already seen (render nothing)
  const [seen, setSeen] = useState<boolean | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  // Check on mount whether the tour has already been shown.
  useEffect(() => {
    AsyncStorage.getItem(WELCOME_SEEN_KEY)
      .then((val) => setSeen(val === 'true'))
      .catch(() => setSeen(false)); // on error, show the tour once
  }, []);

  const handleDone = async () => {
    try {
      await AsyncStorage.setItem(WELCOME_SEEN_KEY, 'true');
    } catch {
      // Non-fatal: worst case the tour shows again next launch
    }
    onDismiss();
  };

  const handleNext = () => {
    const next = activeIndex + 1;
    scrollRef.current?.scrollTo({ x: next * SCREEN_WIDTH, animated: true });
    setActiveIndex(next);
  };

  const handleScroll = (e: { nativeEvent: { contentOffset: { x: number } } }) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setActiveIndex(idx);
  };

  // While AsyncStorage check is in flight, render nothing (avoids flash).
  if (seen === null) return null;
  // Already seen on a previous launch — skip entirely.
  if (seen === true) return null;

  const isLastSlide = activeIndex === SLIDES.length - 1;

  return (
    <View style={styles.container} testID="welcome-tour">
      {/* Skip link — always visible in top-right */}
      <TouchableOpacity
        style={styles.skipBtn}
        onPress={handleDone}
        accessibilityRole="button"
        accessibilityLabel={t('welcome.skip')}
        testID="welcome-skip"
      >
        <Text style={styles.skipText}>{t('welcome.skip')}</Text>
      </TouchableOpacity>

      {/* Slides */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        scrollEventThrottle={16}
        testID="welcome-scroll"
      >
        {SLIDES.map((slide, i) => (
          <View key={i} style={styles.slide} testID={`welcome-slide-${i}`}>
            <Text style={styles.emoji}>{t(slide.emojiKey)}</Text>
            <Text style={styles.title}>{t(slide.titleKey)}</Text>
            <Text style={styles.body}>{t(slide.bodyKey)}</Text>
          </View>
        ))}
      </ScrollView>

      {/* Pagination dots */}
      <View style={styles.dotsRow} testID="welcome-dots">
        {SLIDES.map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i === activeIndex && styles.dotActive]}
            testID={`welcome-dot-${i}`}
          />
        ))}
      </View>

      {/* Primary CTA */}
      {isLastSlide ? (
        <TouchableOpacity
          style={styles.ctaBtn}
          onPress={handleDone}
          accessibilityRole="button"
          testID="welcome-got-it"
        >
          <Text style={styles.ctaText}>{t('welcome.gotIt')}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={styles.ctaBtn}
          onPress={handleNext}
          accessibilityRole="button"
          testID="welcome-next"
        >
          <Text style={styles.ctaText}>{t('welcome.next')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.background,
    zIndex: 9999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  skipBtn: {
    position: 'absolute',
    top: 56,
    right: 24,
    zIndex: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  skipText: {
    ...Type.bodySm,
    color: Colors.textSecondary,
  },
  slide: {
    width: SCREEN_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingVertical: 80,
  },
  emoji: {
    fontSize: 64,
    marginBottom: 24,
    textAlign: 'center',
  },
  title: {
    ...Type.h1,
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 16,
  },
  body: {
    ...Type.body,
    color: Colors.text,
    textAlign: 'center',
    lineHeight: 22,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 24,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.border,
  },
  dotActive: {
    backgroundColor: Colors.primary,
    width: 20,
    borderRadius: 4,
  },
  ctaBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingHorizontal: 40,
    paddingVertical: 14,
    marginBottom: 48,
  },
  ctaText: {
    ...Type.button,
    color: Colors.white,
  },
});
