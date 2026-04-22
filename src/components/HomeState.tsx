import React, { useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '../theme/colors';
import { Radii, Shadows, Spacing, Type } from '../theme/tokens';
import { GuideAvatar } from './GuideAvatar';
import { t } from '../i18n';
import type { GPSContext } from '../services/InferenceService';
import type { Poi } from '../services/PoiService';

interface Props {
  /** Human-readable place name ("Midtown, NYC"). Falls back to "here". */
  placeName: string | null;
  /** Current search radius in metres — shown on the "Around you" header. */
  radiusMeters: number;
  /** Nearby POIs, sorted by distance. */
  pois: Poi[];
  /** Open the itinerary planner. */
  onPlanDay: () => void;
  /** Open the trivia quiz. */
  onQuiz: () => void;
  /** Ask the guide a prompt (tapping a starter chip or POI row). */
  onAsk: (query: string) => void;
  /** Narrate a specific POI (equivalent of tapping its chip in active-chat). */
  onNarratePoi: (poi: Poi) => void;
  /** Open the settings sheet (user taps "1 km · change"). */
  onChangeRadius: () => void;
  /** Disable interaction while a stream is in flight. */
  disabled?: boolean;
  /** True while we're still resolving GPS or fetching nearby POIs. */
  loading?: boolean;
  /** True when GPS hasn't produced a fix yet (vs. fix present but no POIs). */
  awaitingLocation?: boolean;
}

/**
 * Home / empty state for ChatScreen. Shown when the user has no messages yet.
 * Replaces the old "13 rows of chrome" with a purposeful landing page:
 *   - Greeting ("Good morning · You're in Midtown.")
 *   - Two primary CTAs (Plan my day · Quiz me)
 *   - "Around you" POI list
 *   - Starter prompt chips along the bottom
 *
 * Implements the Home state from Option A of the design handoff's
 * Local Guide Chat Redesign.html (Soft Tactile style).
 */
export function HomeState({
  placeName,
  radiusMeters,
  pois,
  onPlanDay,
  onQuiz,
  onAsk,
  onNarratePoi,
  onChangeRadius,
  disabled = false,
  loading = false,
  awaitingLocation = false,
}: Props) {
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 5) return t('home.greetingNight');
    if (h < 12) return t('home.greetingMorning');
    if (h < 18) return t('home.greetingAfternoon');
    return t('home.greetingEvening');
  }, []);

  const radiusLabel =
    radiusMeters >= 1000
      ? `${(radiusMeters / 1000).toFixed(radiusMeters % 1000 === 0 ? 0 : 1)} km`
      : `${radiusMeters} m`;

  // Keep both wikipedia + llm sources; llm is the only flavor we get in
  // offline mode and filtering it out would leave the section permanently
  // empty when the user has toggled offline on.
  const poiList = pois.slice(0, 3);

  const starters = [t('home.starterFood'), t('home.starterHistory'), t('home.starterWalk')];

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.greetingEyebrow}>{greeting}</Text>
      <Text style={styles.greetingTitle}>
        {placeName ? t('home.youreIn', { place: placeName }) : t('home.youreHere')}
      </Text>
      <Text style={styles.greetingTitle}>{t('home.wantToWander')}</Text>

      <View style={styles.ctaRow}>
        <CtaCard
          glyph="🗺"
          label={t('home.planMyDay')}
          sub={t('home.planMyDaySub')}
          onPress={onPlanDay}
          disabled={disabled}
          primary
          testID="home-plan-day"
        />
        <CtaCard
          glyph="🎯"
          label={t('home.quizMe')}
          sub={t('home.quizMeSub')}
          onPress={onQuiz}
          disabled={disabled}
          testID="home-quiz"
        />
      </View>

      <View style={styles.aroundHeader}>
        <Text style={styles.aroundTitle}>{t('home.aroundYou')}</Text>
        <TouchableOpacity onPress={onChangeRadius}>
          <Text style={styles.radiusLink}>{t('home.changeRadius', { km: radiusLabel })}</Text>
        </TouchableOpacity>
      </View>

      {poiList.length === 0 ? (
        loading || awaitingLocation ? (
          <View style={styles.emptyHint}>
            <ActivityIndicator size="small" color={Colors.primaryDark} />
            <Text style={styles.emptyHintText}>
              {awaitingLocation ? t('home.aroundYouWaitingGps') : t('home.aroundYouLoading')}
            </Text>
          </View>
        ) : (
          <View style={styles.emptyHint}>
            <GuideAvatar size={28} />
            <Text style={styles.emptyHintText}>{t('home.aroundYouEmpty')}</Text>
          </View>
        )
      ) : (
        <View style={styles.poiList}>
          {poiList.map((p) => (
            <PoiRow key={p.pageId} poi={p} onPress={() => onNarratePoi(p)} disabled={disabled} />
          ))}
        </View>
      )}

      <View style={styles.startersWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.starters}
        >
          {starters.map((text) => (
            <TouchableOpacity
              key={text}
              style={styles.starterChip}
              onPress={() => onAsk(text)}
              disabled={disabled}
            >
              <Text style={styles.starterLabel} numberOfLines={1}>
                {text}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </ScrollView>
  );
}

function CtaCard({
  glyph,
  label,
  sub,
  onPress,
  disabled,
  primary,
  testID,
}: {
  glyph: string;
  label: string;
  sub: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.cta, primary ? styles.ctaPrimary : styles.ctaSecondary]}
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      accessibilityRole="button"
      testID={testID}
    >
      <Text style={styles.ctaGlyph}>{glyph}</Text>
      <Text style={[styles.ctaLabel, primary ? styles.ctaLabelPrimary : styles.ctaLabelSecondary]}>
        {label}
      </Text>
      <Text style={[styles.ctaSub, primary ? styles.ctaSubPrimary : styles.ctaSubSecondary]}>
        {sub}
      </Text>
    </TouchableOpacity>
  );
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  if (meters < 10000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000)} km`;
}

function PoiRow({ poi, onPress, disabled }: { poi: Poi; onPress: () => void; disabled?: boolean }) {
  const isLlm = poi.source === 'llm';
  const emoji = isLlm ? '🧠' : poiEmoji(poi);
  return (
    <TouchableOpacity
      style={styles.poiRow}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={poi.title}
    >
      <View style={styles.poiIcon}>
        <Text style={styles.poiEmoji}>{emoji}</Text>
      </View>
      <View style={styles.poiBody}>
        <Text style={styles.poiTitle} numberOfLines={1}>
          {poi.title}
        </Text>
        {poi.description ? (
          <Text style={styles.poiSub} numberOfLines={1}>
            {poi.description}
          </Text>
        ) : null}
      </View>
      {isLlm ? null : (
        <View style={styles.poiDistanceBadge}>
          <Text style={styles.poiDistanceText}>{formatDistance(poi.distanceMeters)}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// Best-effort emoji pick based on POI description keywords. Falls back to 📍.
// Only runs on the 3 POIs shown in Home, so cost is negligible.
function poiEmoji(poi: Poi): string {
  const text = `${poi.title} ${poi.description ?? ''}`.toLowerCase();
  if (/\b(park|garden|plaza|square|forest|beach|coast)\b/.test(text)) return '🌳';
  if (/\b(museum|gallery|exhibit)\b/.test(text)) return '🎨';
  if (/\b(restaurant|cafe|café|food|kitchen|bar|pub|market)\b/.test(text)) return '🍜';
  if (/\b(church|cathedral|temple|mosque|shrine|synagogue)\b/.test(text)) return '⛪';
  if (/\b(library|university|college|school|bookstore)\b/.test(text)) return '📚';
  if (/\b(theater|theatre|cinema|opera|stage)\b/.test(text)) return '🎭';
  if (/\b(monument|statue|memorial|tower)\b/.test(text)) return '🗿';
  return '📍';
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  greetingEyebrow: {
    ...Type.metaUpper,
    color: Colors.textTertiary,
    marginBottom: 4,
  },
  greetingTitle: {
    ...Type.h1,
    color: Colors.text,
    lineHeight: 30,
  },
  ctaRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  cta: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: Radii.lg,
    gap: 6,
  },
  ctaPrimary: {
    backgroundColor: Colors.primary,
    ...Shadows.ctaHard,
  },
  ctaSecondary: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.softOutset,
  },
  ctaGlyph: {
    fontSize: 20,
  },
  ctaLabel: {
    ...Type.title,
  },
  ctaLabelPrimary: {
    color: '#FFFFFF',
  },
  ctaLabelSecondary: {
    color: Colors.text,
  },
  ctaSub: {
    ...Type.hint,
  },
  ctaSubPrimary: {
    color: 'rgba(255,255,255,0.85)',
  },
  ctaSubSecondary: {
    color: Colors.textTertiary,
  },
  aroundHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
    marginTop: Spacing.xs,
  },
  aroundTitle: {
    ...Type.title,
    color: Colors.text,
  },
  radiusLink: {
    ...Type.metaUpper,
    color: Colors.primaryDark,
  },
  poiList: {
    gap: 6,
  },
  poiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: Radii.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  poiIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  poiEmoji: {
    fontSize: 16,
  },
  poiBody: {
    flex: 1,
  },
  poiTitle: {
    ...Type.poi,
    color: Colors.text,
  },
  poiSub: {
    ...Type.hint,
    color: Colors.textTertiary,
    marginTop: 1,
  },
  poiDistanceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radii.sm,
    backgroundColor: Colors.primaryLight,
  },
  poiDistanceText: {
    ...Type.chip,
    color: Colors.primaryDark,
  },
  emptyHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: Radii.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  emptyHintText: {
    ...Type.bodySm,
    color: Colors.textSecondary,
    flex: 1,
  },
  startersWrap: {
    marginTop: Spacing.lg,
    marginHorizontal: -Spacing.lg,
  },
  starters: {
    paddingHorizontal: Spacing.lg,
    gap: 6,
  },
  starterChip: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: Radii.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  starterLabel: {
    ...Type.chip,
    color: Colors.textSecondary,
  },
});
