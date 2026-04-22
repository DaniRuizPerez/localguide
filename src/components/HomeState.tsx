import React from 'react';
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
  onAsk,
  onNarratePoi,
  onChangeRadius,
  disabled = false,
  loading = false,
  awaitingLocation = false,
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

  const starters = [t('home.starterFood'), t('home.starterHistory'), t('home.starterWalk')];

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
  // Infer from the title for every source. LLM picks don't carry a Wikipedia
  // description, but "Notre Dame Cathedral" / "Golden Gate Bridge" / "Stanford
  // University" still resolve via the title alone. Fall back to 🧠 (not 📍)
  // only when nothing infers, so uncategorized AI picks stay visibly marked.
  const inferred = poiEmoji(poi);
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
      {isLlm ? null : (
        <View style={styles.poiDistanceBadge}>
          <Text style={styles.poiDistanceText}>{formatDistance(poi.distanceMeters)}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// Best-effort emoji pick from POI title + Wikipedia short description. Order
// matters: more specific categories match first so a "Royal Opera House"
// lands on 🎭 rather than 🏛, and "Brooklyn Bridge" lands on 🌉 rather than 📍.
// Each branch is a \b-anchored word list so a substring like "barista" in a
// description can't accidentally match "bar".
function poiEmoji(poi: Poi): string {
  const text = `${poi.title} ${poi.description ?? ''}`.toLowerCase();

  // Nature & outdoors.
  if (/\b(mountain|peak|summit|hill|volcano|canyon|valley|cliff)\b/.test(text)) return '⛰';
  if (/\b(river|lake|pond|waterfall|creek|bay|fjord|lagoon)\b/.test(text)) return '🌊';
  if (/\b(beach|coast|shore|seaside|island)\b/.test(text)) return '🏖';
  if (/\b(forest|woods?|nature reserve|wildlife|national park)\b/.test(text)) return '🌲';
  if (/\b(park|garden|arboretum|botanical|plaza|square|promenade)\b/.test(text)) return '🌳';

  // Religious buildings.
  if (/\b(cathedral|basilica|church|chapel|abbey|convent|monastery)\b/.test(text)) return '⛪';
  if (/\b(mosque|minaret)\b/.test(text)) return '🕌';
  if (/\b(synagogue)\b/.test(text)) return '🕍';
  if (/\b(temple|shrine|pagoda)\b/.test(text)) return '🛕';

  // Culture & education.
  if (/\b(museum|gallery|exhibit|exhibition)\b/.test(text)) return '🎨';
  if (/\b(theater|theatre|opera|auditorium|concert hall|playhouse)\b/.test(text)) return '🎭';
  if (/\b(cinema|movie theater|film)\b/.test(text)) return '🎬';
  if (/\b(library|bookstore|archive)\b/.test(text)) return '📚';
  if (/\b(university|college|campus|institute|academy)\b/.test(text)) return '🎓';
  if (/\b(school|kindergarten)\b/.test(text)) return '🏫';

  // Historic & civic.
  if (/\b(castle|fortress|citadel|palace|château)\b/.test(text)) return '🏰';
  if (/\b(monument|memorial|mausoleum|tomb|cemetery)\b/.test(text)) return '🗿';
  if (/\b(statue|sculpture)\b/.test(text)) return '🗽';
  if (/\b(tower|lighthouse|observation deck|belvedere)\b/.test(text)) return '🗼';
  if (/\b(bridge|viaduct|aqueduct)\b/.test(text)) return '🌉';
  // Civic & government. Multi-word phrases (e.g. "civic center") avoid
  // stealing random single-word hits like "government road" — those fall
  // through to the street matcher below.
  if (/\b(post office)\b/.test(text)) return '🏤';
  if (/\b(police (station|headquarters|precinct)|sheriff'?s? office|gendarmerie)\b/.test(text)) return '🚔';
  if (/\b(fire (station|department|house)|firehouse)\b/.test(text)) return '🚒';
  if (
    /\bcivic (center|centre|hall|building|campus|auditorium|complex)\b/.test(text) ||
    /\bgovernment (center|centre|building|complex|house|office|offices)\b/.test(text) ||
    /\bmunicipal (hall|building|center|centre|office|offices|complex)\b/.test(text) ||
    /\badministrative (building|center|centre|complex|offices)\b/.test(text) ||
    /\b(city hall|town hall|capitol|parliament|courthouse|embassy|prefecture|consulate|tribunal|ministry)\b/.test(text)
  ) return '🏛';

  // Hospitality & commerce.
  if (/\b(restaurant|bistro|brasserie|eatery|diner|canteen)\b/.test(text)) return '🍽';
  if (/\b(cafe|café|coffee|bakery|patisserie)\b/.test(text)) return '☕';
  if (/\b(bar|pub|tavern|brewery|winery|distillery)\b/.test(text)) return '🍻';
  if (/\b(market|bazaar|souk)\b/.test(text)) return '🧺';
  if (/\b(hotel|inn|hostel|resort|lodge)\b/.test(text)) return '🏨';
  if (/\b(shopping|mall|department store|arcade)\b/.test(text)) return '🛍';

  // Transit & sport.
  if (/\b(train station|railway station|metro|subway|terminus)\b/.test(text)) return '🚉';
  if (/\b(airport|aerodrome)\b/.test(text)) return '✈️';
  if (/\b(port|harbor|harbour|marina|pier|dock)\b/.test(text)) return '⚓';
  if (/\b(stadium|arena|ballpark|velodrome)\b/.test(text)) return '🏟';
  if (/\b(zoo|aquarium)\b/.test(text)) return '🦁';
  if (/\b(hospital|clinic)\b/.test(text)) return '🏥';

  // Generic fallbacks for anything building-shaped.
  if (/\b(skyscraper|high.?rise|office tower)\b/.test(text)) return '🏙';
  if (/\b(building|house|mansion|villa|estate|hall|pavilion)\b/.test(text)) return '🏛';

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
