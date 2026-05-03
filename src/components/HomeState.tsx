import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '../theme/colors';
import { Radii, Shadows, Spacing, Type } from '../theme/tokens';
import { GuideAvatar } from './GuideAvatar';
import { t } from '../i18n';
import type { GPSContext } from '../services/InferenceService';
import type { Poi } from '../services/PoiService';
import { poiEmojiFor } from '../services/poiTopic';

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
  /** Navigate to the Map screen (now a pushed stack destination). */
  onOpenMap: () => void;
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
  /**
   * True when location permission has been denied (or an error occurred) and
   * the user has not entered a manual location. In this state the "Around you"
   * list should show a "grant permission" nudge instead of the generic empty
   * state or an LLM-hallucinated list.
   */
  locationDenied?: boolean;
}

/**
 * Home / empty state for ChatScreen. Shown when the user has no messages yet.
 * Replaces the old "13 rows of chrome" with a purposeful landing page:
 *   - Location headline ("You're in Midtown. Want to wander?")
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
  onOpenMap,
  onNarratePoi,
  onChangeRadius,
  disabled = false,
  loading = false,
  awaitingLocation = false,
  locationDenied = false,
}: Props) {
  const radiusLabel =
    radiusMeters >= 1000
      ? `${(radiusMeters / 1000).toFixed(radiusMeters % 1000 === 0 ? 0 : 1)} km`
      : `${radiusMeters} m`;

  // Keep both wikipedia + llm sources; llm is the only flavor we get in
  // offline mode and filtering it out would leave the section permanently
  // empty when the user has toggled offline on. The outer ScrollView handles
  // overflow so we intentionally don't truncate — the user asked to see
  // every attraction in the radius.
  const poiList = pois;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.greetingTitle}>
        {placeName ? t('home.youreIn', { place: placeName }) : t('home.youreHere')}
      </Text>
      <Text style={styles.greetingTitle}>{t('home.wantToWander')}</Text>

      <View style={styles.ctaRow}>
        <CtaCard
          glyph="📅"
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
        <CtaCard
          glyph="🗺"
          label={t('home.openMap')}
          sub={t('home.openMapSub')}
          onPress={onOpenMap}
          disabled={disabled}
          testID="home-open-map"
        />
      </View>

      <View style={styles.aroundHeader}>
        <Text style={styles.aroundTitle}>{t('home.aroundYou')}</Text>
        <TouchableOpacity onPress={onChangeRadius}>
          <Text style={styles.radiusLink}>{t('home.changeRadius', { km: radiusLabel })}</Text>
        </TouchableOpacity>
      </View>

      {poiList.length === 0 ? (
        locationDenied ? (
          <View style={styles.emptyHint}>
            <GuideAvatar size={28} />
            <Text style={styles.emptyHintText}>{t('home.aroundYouNoPermission')}</Text>
          </View>
        ) : loading || awaitingLocation ? (
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
          {(() => {
            // Split into real (geo/wikipedia) vs. LLM-suggested. Drop a
            // labeled divider between the two groups so the user can tell
            // at a glance which rows are verifiable and which are
            // AI-suggested. Order is preserved within each group.
            const realPois = poiList.filter((p) => p.source !== 'llm');
            const aiPois = poiList.filter((p) => p.source === 'llm');
            return (
              <>
                {realPois.map((p) => (
                  <PoiRow key={p.pageId} poi={p} onPress={() => onNarratePoi(p)} disabled={disabled} />
                ))}
                {aiPois.length > 0 && (
                  <View style={styles.aiDivider}>
                    <View style={styles.aiDividerLine} />
                    <Text style={styles.aiDividerText}>
                      {t('home.aiHallucinationDivider')}
                    </Text>
                    <View style={styles.aiDividerLine} />
                  </View>
                )}
                {aiPois.map((p) => (
                  <PoiRow key={p.pageId} poi={p} onPress={() => onNarratePoi(p)} disabled={disabled} />
                ))}
              </>
            );
          })()}
        </View>
      )}

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
  // Infer from the title for every source. LLM picks don't carry a Wikipedia
  // description, but "Notre Dame Cathedral" / "Golden Gate Bridge" / "Stanford
  // University" still resolve via the title alone. Fall back to 🧠 (not 📍)
  // only when nothing infers, so uncategorized AI picks stay visibly marked.
  const inferred = poiEmojiFor(poi);
  const emoji = isLlm && inferred === '📍' ? '🧠' : inferred;
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
      {isLlm ? (
        <View style={styles.poiWarnBadge}>
          <Text style={styles.poiWarnText}>{t('home.aiHallucinationBadge')}</Text>
        </View>
      ) : (
        <View style={styles.poiDistanceBadge}>
          <Text style={styles.poiDistanceText}>{formatDistance(poi.distanceMeters)}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
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
  // Warning badge for LLM-sourced suggestions: same shape as distance badge
  // but in a clearly different colour (warning amber-ish — uses
  // Colors.error's surface so it stands out against the soft primary
  // backdrop). Tells the user the row may be hallucinated.
  poiWarnBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radii.sm,
    backgroundColor: Colors.errorLight,
  },
  poiWarnText: {
    ...Type.chip,
    color: Colors.error,
  },
  // Divider that visually separates verifiable (geo/wikipedia) POIs from
  // AI-generated suggestions. The disclaimer sits inline between two
  // hairline rules so it reads as a section header rather than a
  // floating warning.
  aiDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
    paddingHorizontal: 4,
  },
  aiDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.borderLight,
  },
  aiDividerText: {
    ...Type.bodySm,
    color: Colors.textTertiary,
    fontStyle: 'italic',
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
});
