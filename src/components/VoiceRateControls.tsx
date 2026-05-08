import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { CountryPackPicker } from './CountryPackPicker';
import { PillowChip } from './PillowChip';
import { TopicChips, type GuideTopic } from './TopicChips';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../theme/colors';
import { Radii, Shadows, Sizing, Spacing, Type } from '../theme/tokens';
import { guidePrefs, type ModeChoice } from '../services/GuidePrefs';
import { chatStore } from '../services/ChatStore';
import {
  narrationPrefs,
  NARRATION_LENGTH_VALUES,
  type NarrationLength,
} from '../services/NarrationPrefs';
import { speechService } from '../services/SpeechService';
import { humanizeVoices, pickDiverseVoices } from '../services/voiceLabels';
import { currentSpeechTag, getLocale, t } from '../i18n';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useAppMode } from '../hooks/useAppMode';
import { appMode } from '../services/AppMode';
import type * as SpeechModule from 'expo-speech';

type Voice = SpeechModule.Voice;

interface Props {
  visible: boolean;
  onClose: () => void;

  // Settings for "The guide" section. The ChatScreen owns the underlying
  // state; we pass it in so all settings have one home, matching the design
  // handoff's Option A settings sheet.
  autoGuide: boolean;
  onAutoGuideChange: (next: boolean) => void;
  speak: boolean;
  onSpeakChange: (next: boolean) => void;
  hiddenGems: boolean;
  onHiddenGemsChange: (next: boolean) => void;
  topics: readonly GuideTopic[];
  onTopicsChange: (next: GuideTopic[]) => void;

  // Settings for "Search area".
  radiusMeters: number;
  onRadiusChange: (meters: number) => void;
}

const RATE_MIN = 0.6;
const RATE_MAX = 1.6;
const RATE_STEP = 0.05;

// The radii the UI exposes as segmented options. Keep in sync with the
// inner clamp in poiService.fetchNearby (10..10000).
const RADIUS_OPTIONS: Array<{ label: string; meters: number }> = [
  { label: '1km', meters: 1000 },
  { label: '2km', meters: 2000 },
  { label: '5km', meters: 5000 },
  { label: '10km', meters: 10000 },
];

function formatRate(rate: number): string {
  return `${rate.toFixed(2)}×`;
}

function useVoicesForLocale(active: boolean): Voice[] {
  const [voices, setVoices] = useState<Voice[]>([]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const fn = speechService.getAvailableVoices;
    if (typeof fn !== 'function') {
      setVoices([]);
      return;
    }
    fn.call(speechService)
      .then((list) => {
        if (cancelled) return;
        const speechTag = currentSpeechTag().toLowerCase();
        const langBase = getLocale();
        const filtered = list.filter((v) => {
          const lang = (v.language ?? '').toLowerCase();
          return lang === speechTag || lang.split(/[-_]/)[0] === langBase;
        });
        setVoices(filtered);
      })
      .catch(() => setVoices([]));
    return () => {
      cancelled = true;
    };
  }, [active]);

  return voices;
}

/**
 * Settings sheet — the single home for every toggle, slider, and segmented
 * control that used to clutter the Chat chrome. Implements Option A of the
 * design handoff (Local Guide Chat Redesign.html):
 *
 *   CONNECTION     Mode · Network state · Offline geocoder · Country packs
 *   THE GUIDE      Auto-Guide · Hidden gems · Speak
 *   SEARCH AREA    Radius · Length
 *   NARRATION      Rate · Voice picker
 *
 * The component keeps its original `VoiceRateControls` name for backward
 * compatibility with tests that import it, but the surface is broader now.
 */
export function VoiceRateControls({
  visible,
  onClose,
  autoGuide,
  onAutoGuideChange,
  speak,
  onSpeakChange,
  hiddenGems,
  onHiddenGemsChange,
  topics,
  onTopicsChange,
  radiusMeters,
  onRadiusChange,
}: Props) {
  const insets = useSafeAreaInsets();
  const [rate, setRate] = useState<number>(narrationPrefs.get().rate);
  const [voice, setVoice] = useState<string | undefined>(narrationPrefs.get().voice);
  const [length, setLength] = useState<NarrationLength>(narrationPrefs.get().length);
  const [useOfflineGeocoder, setUseOfflineGeocoder] = useState<boolean>(
    guidePrefs.get().useOfflineGeocoder
  );
  const [packPickerOpen, setPackPickerOpen] = useState(false);
  const availableVoices = useVoicesForLocale(visible);
  const networkState = useNetworkStatus();
  const { effective, choice: appModeChoice } = useAppMode();

  useEffect(() => {
    return narrationPrefs.subscribe((p) => {
      setRate(p.rate);
      setVoice(p.voice);
      setLength(p.length);
    });
  }, []);

  useEffect(() => {
    return guidePrefs.subscribe((p) => {
      setUseOfflineGeocoder(p.useOfflineGeocoder);
    });
  }, []);

  const voiceChips = useMemo(() => {
    // Typical Android devices expose 40–60 near-duplicate voices per locale.
    // Show only 5 carefully-diverse picks (different gender/locale/quality
    // combinations) to keep the picker scannable. If the user's current
    // choice happens to fall outside that top-5, we re-add it so switching
    // the picker open doesn't silently blow away their selection.
    const curated = pickDiverseVoices(availableVoices, 5);
    const selected = availableVoices.find((v) => v.identifier === voice);
    const forDisplay =
      selected && !curated.some((v) => v.identifier === selected.identifier)
        ? [...curated, selected]
        : curated;

    const head: Array<{ id: string | undefined; label: string }> = [
      { id: undefined, label: t('narration.voiceSystemDefault') },
    ];
    const labeled = humanizeVoices(forDisplay).map(({ voice, label }) => ({
      id: voice.identifier,
      label,
    }));
    return [...head, ...labeled];
  }, [availableVoices, voice]);

  const lengthLabel = (value: NarrationLength): string => {
    switch (value) {
      case 'short':
        return t('narration.lengthShort');
      case 'standard':
        return t('narration.lengthStandard');
      case 'deep':
        return t('narration.lengthDeepDive');
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      hardwareAccelerated
    >
      <View style={styles.backdrop}>
        {/* Tappable dim area sits behind the sheet so the sheet itself doesn't
            need an onPress wrapper stealing from the ScrollView's gestures. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel={t('narration.done')}
        />
        <View
          style={[styles.sheet, { paddingBottom: Spacing.lg + insets.bottom }]}
        >
          <View style={styles.handle} />

          <View style={styles.headerRow}>
            <View>
              <Text style={styles.heading}>{t('settings.title')}</Text>
              <Text style={styles.subheading}>{t('settings.subtitle')}</Text>
            </View>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            removeClippedSubviews={false}
          >
            {/* CONNECTION — mode choice, live network status, geocoding. */}
            <SettingsGroup label={t('settings.groupConnection')}>
              {effective === 'offline' && (
                <Text style={styles.offlineSubtitle}>{t('offlineNotice.pillSubtitle')}</Text>
              )}
              <ModePicker active={appModeChoice} />
              <NetworkStatusRow networkState={networkState} />
              <ToggleRow
                label="Offline geocoder"
                sub="Use bundled place data instead of the system geocoder."
                value={useOfflineGeocoder}
                onChange={(next) => guidePrefs.setUseOfflineGeocoder(next)}
                tint={Colors.primary}
              />
              <TouchableOpacity
                style={styles.toggleRow}
                onPress={() => setPackPickerOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Country detail packs"
              >
                <View style={styles.toggleText}>
                  <Text style={styles.toggleLabel}>Country detail packs</Text>
                  <Text style={styles.toggleSub}>
                    Add per-country place data for richer offline names.
                  </Text>
                </View>
                <Text style={styles.disclosure}>›</Text>
              </TouchableOpacity>
            </SettingsGroup>

            {/* THE GUIDE — behaviour toggles */}
            <SettingsGroup label={t('settings.groupGuide')}>
              <ToggleRow
                label={t('settings.autoGuideLabel')}
                sub={t('settings.autoGuideSub')}
                value={autoGuide}
                onChange={onAutoGuideChange}
                tint={Colors.secondary}
              />
              <ToggleRow
                label={t('settings.hiddenGemsLabel')}
                sub={t('settings.hiddenGemsSub')}
                value={hiddenGems}
                onChange={onHiddenGemsChange}
                tint={Colors.secondary}
              />
              <ToggleRow
                label={t('settings.speakLabel')}
                sub={t('settings.speakSub')}
                value={speak}
                onChange={onSpeakChange}
                tint={Colors.primary}
              />
              <View style={styles.topicRow}>
                <Text style={styles.toggleLabel}>{t('settings.topicLabel')}</Text>
                <Text style={styles.toggleSub}>{t('settings.topicSub')}</Text>
                <TopicChips
                  selected={topics}
                  onChange={onTopicsChange}
                  style={styles.topicChips}
                />
              </View>
            </SettingsGroup>

            {/* SEARCH AREA — radius only; length moved into NARRATION. */}
            <SettingsGroup label={t('settings.groupSearch')}>
              <SegmentedRow
                label={t('settings.radiusLabel')}
                options={RADIUS_OPTIONS.map((o) => o.label)}
                activeIdx={RADIUS_OPTIONS.findIndex((o) => o.meters === radiusMeters)}
                onSelect={(i) => onRadiusChange(RADIUS_OPTIONS[i].meters)}
              />
            </SettingsGroup>

            {/* NARRATION — length + rate + voice picker, all in one group. */}
            <SettingsGroup label={t('settings.groupNarration')}>
              <SegmentedRow
                label={t('settings.lengthLabel')}
                options={NARRATION_LENGTH_VALUES.map(lengthLabel)}
                activeIdx={NARRATION_LENGTH_VALUES.indexOf(length)}
                onSelect={(i) => narrationPrefs.setLength(NARRATION_LENGTH_VALUES[i])}
              />
              <View style={styles.sliderRow}>
                <View style={styles.sliderHeader}>
                  <Text style={styles.toggleLabel}>{t('narration.rateLabel')}</Text>
                  <Text style={styles.rateBadge}>{formatRate(rate)}</Text>
                </View>
                <Slider
                  style={styles.slider}
                  minimumValue={RATE_MIN}
                  maximumValue={RATE_MAX}
                  step={RATE_STEP}
                  value={rate}
                  minimumTrackTintColor={Colors.primary}
                  maximumTrackTintColor={Colors.border}
                  thumbTintColor={Colors.primary}
                  onValueChange={(next) => setRate(next)}
                  onSlidingComplete={(next) => narrationPrefs.setRate(next)}
                  accessibilityLabel={t('narration.rateLabel')}
                />
              </View>
              <View style={styles.voiceRow}>
                <Text style={styles.toggleLabel}>{t('narration.voiceLabel')}</Text>
                {voiceChips.length === 1 ? (
                  <Text style={styles.emptyHint}>{t('narration.voiceNoneAvailable')}</Text>
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.voiceChipRow}
                  >
                    {voiceChips.map((chip, idx) => (
                      <PillowChip
                        key={chip.id ?? `default-${idx}`}
                        label={chip.label}
                        active={chip.id === voice}
                        onPress={() => narrationPrefs.setVoice(chip.id)}
                      />
                    ))}
                  </ScrollView>
                )}
              </View>
            </SettingsGroup>
            {/* CLEAR CONVERSATION */}
            <TouchableOpacity
              style={styles.reportRow}
              onPress={() =>
                Alert.alert(
                  'Clear conversation?',
                  'Your current chat history will be deleted.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Clear',
                      style: 'destructive',
                      onPress: () => chatStore.clear(),
                    },
                  ]
                )
              }
              accessibilityRole="button"
              accessibilityLabel="Clear conversation"
              testID="settings-clear-conversation"
            >
              <Text style={[styles.reportLabel, styles.clearLabel]}>Clear conversation</Text>
            </TouchableOpacity>

            {/* REPORT */}
            <TouchableOpacity
              style={styles.reportRow}
              onPress={() =>
                Linking.openURL(
                  'mailto:buhnenollc@gmail.com?subject=AI%20Offline%20Tour%20Guide%20-%20Report'
                )
              }
              accessibilityRole="link"
              accessibilityLabel={t('settings.reportProblem')}
            >
              <Text style={styles.reportLabel}>{t('settings.reportProblem')}</Text>
            </TouchableOpacity>
          </ScrollView>

          <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
            <Text style={styles.doneBtnText}>{t('narration.done')}</Text>
          </TouchableOpacity>
        </View>
      </View>
      <CountryPackPicker visible={packPickerOpen} onClose={() => setPackPickerOpen(false)} />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// ModePicker — inline three-option mode selector for the CONNECTION section.
// Mirrors the cards in HowShouldIAnswerSheet without extracting a shared component.
// ---------------------------------------------------------------------------

interface ModeOption {
  value: ModeChoice;
  label: string;
  sub: string;
}

const MODE_OPTIONS: ModeOption[] = [
  { value: 'auto',          label: t('mode.optAuto'),    sub: t('mode.optAutoSub')    },
  { value: 'force-online',  label: t('mode.optOnline'),  sub: t('mode.optOnlineSub')  },
  { value: 'force-offline', label: t('mode.optOffline'), sub: t('mode.optOfflineSub') },
];

function ModePicker({ active }: { active: ModeChoice }) {
  return (
    <View style={styles.modePickerContainer}>
      {MODE_OPTIONS.map((opt) => {
        const isActive = active === opt.value;
        return (
          <TouchableOpacity
            key={opt.value}
            testID={`settings-mode-opt-${opt.value}`}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            style={[styles.modeOption, isActive && styles.modeOptionActive]}
            onPress={() => appMode.setMode(opt.value)}
            activeOpacity={0.7}
          >
            <View style={styles.modeOptionBody}>
              <Text style={[styles.modeOptionLabel, isActive && styles.modeOptionLabelActive]}>
                {opt.label}
              </Text>
              <Text style={styles.modeOptionSub}>{opt.sub}</Text>
            </View>
            <View style={[styles.modeRadio, isActive && styles.modeRadioActive]}>
              {isActive && <View style={styles.modeRadioDot} />}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function SettingsGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={styles.groupBody}>{children}</View>
    </View>
  );
}

function ToggleRow({
  label,
  sub,
  value,
  onChange,
  tint,
}: {
  label: string;
  sub: string;
  value: boolean;
  onChange: (next: boolean) => void;
  tint: string;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleSub}>{sub}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: Colors.border, true: tint }}
        thumbColor={Colors.surface}
      />
    </View>
  );
}

// Read-only row that shows the live network reachability state.
function NetworkStatusRow({
  networkState,
}: {
  networkState: 'online' | 'offline' | 'unknown';
}) {
  let dotColor: string;
  let statusLabel: string;

  if (networkState === 'online') {
    dotColor = Colors.success;
    statusLabel = t('settings.networkStateOnline');
  } else if (networkState === 'offline') {
    dotColor = Colors.error;
    statusLabel = t('settings.networkStateOffline');
  } else {
    dotColor = Colors.textTertiary;
    statusLabel = t('settings.networkStateProbing');
  }

  return (
    <View style={styles.toggleRow} testID="network-status-row">
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{t('settings.networkStateLabel')}</Text>
      </View>
      <View style={styles.networkStatusValue}>
        <View style={[styles.networkDot, { backgroundColor: dotColor }]} />
        <Text style={styles.networkStatusLabel}>{statusLabel}</Text>
      </View>
    </View>
  );
}

function SegmentedRow({
  label,
  sub,
  options,
  activeIdx,
  onSelect,
}: {
  label: string;
  sub?: string;
  options: string[];
  activeIdx: number;
  onSelect: (i: number) => void;
}) {
  return (
    <View style={styles.segmentRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      {sub ? <Text style={styles.toggleSub}>{sub}</Text> : null}
      <View style={styles.segmentTrack}>
        {options.map((opt, i) => {
          const active = i === activeIdx;
          return (
            <TouchableOpacity
              key={opt}
              style={[styles.segmentOption, active && styles.segmentOptionActive]}
              onPress={() => onSelect(i)}
              accessibilityRole="button"
              accessibilityLabel={opt}
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{opt}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    // Fixed 88% height (was maxHeight) so the internal ScrollView has a
    // deterministic size and can actually overflow + scroll properly. With
    // maxHeight alone, the sheet shrank to content size and only a few
    // pixels of the voice row hung off-screen, making scroll feel frozen.
    // Hard cap at 92vh so on tall phones we don't grow under the status bar.
    height: '88%',
    maxHeight: Sizing.vh(92),
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    // paddingBottom is applied inline so we can add insets.bottom dynamically.
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    ...Shadows.softFloating,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  headerRow: {
    marginBottom: Spacing.md,
  },
  heading: {
    ...Type.h1,
    color: Colors.text,
  },
  subheading: {
    ...Type.bodySm,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  scroll: {
    // flex:1 + minHeight:0 so the ScrollView fills the space left between
    // header and Done button and becomes the only scrollable region.
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    gap: Spacing.md,
    paddingBottom: Spacing.md,
  },
  group: {
    gap: 7,
  },
  groupLabel: {
    ...Type.metaUpper,
    color: Colors.textTertiary,
  },
  groupBody: {
    backgroundColor: Colors.surface,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    padding: 4,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  toggleText: {
    flex: 1,
  },
  toggleLabel: {
    ...Type.body,
    fontFamily: 'Nunito_700Bold',
    color: Colors.text,
  },
  toggleSub: {
    ...Type.hint,
    color: Colors.textTertiary,
    marginTop: 1,
  },
  offlineSubtitle: {
    ...Type.bodySm,
    color: '#8A4B00',
    backgroundColor: Colors.warningLight,
    borderColor: Colors.warning,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
  },
  disclosure: {
    ...Type.h1,
    color: Colors.textTertiary,
    paddingHorizontal: 4,
  },
  networkStatusValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  networkDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  networkStatusLabel: {
    ...Type.chip,
    color: Colors.textSecondary,
  },
  segmentRow: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 6,
  },
  segmentTrack: {
    flexDirection: 'row',
    gap: 3,
    padding: 3,
    backgroundColor: Colors.background,
    borderRadius: Radii.sm,
  },
  segmentOption: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentOptionActive: {
    backgroundColor: Colors.surface,
    ...Shadows.softOutset,
  },
  segmentLabel: {
    ...Type.chip,
    color: Colors.textSecondary,
  },
  segmentLabelActive: {
    color: Colors.primaryDark,
  },
  sliderRow: {
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  rateBadge: {
    ...Type.chip,
    color: Colors.textTertiary,
    fontFamily: 'Nunito_700Bold',
  },
  slider: {
    width: '100%',
    height: 36,
  },
  voiceRow: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 6,
  },
  topicRow: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 2,
  },
  topicChips: {
    // TopicChips' default background is Colors.background; inside a
    // settings-group card we want it transparent so the chip strip sits
    // flush on the surface tone.
    backgroundColor: 'transparent',
    marginTop: 2,
    marginHorizontal: -10,
  },
  voiceChipRow: {
    gap: 8,
    paddingVertical: 2,
  },
  emptyHint: {
    ...Type.bodySm,
    color: Colors.textTertiary,
  },
  reportRow: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  reportLabel: {
    ...Type.bodySm,
    color: Colors.textTertiary,
    textDecorationLine: 'underline',
  },
  clearLabel: {
    color: Colors.error,
  },
  doneBtn: {
    marginTop: Spacing.md,
    backgroundColor: Colors.primary,
    borderRadius: Radii.md,
    paddingVertical: 12,
    alignItems: 'center',
    ...Shadows.ctaHard,
  },
  doneBtnText: {
    ...Type.button,
    color: '#FFFFFF',
  },
  modePickerContainer: {
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  modeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.background,
    padding: 12,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  modeOptionActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.surface,
  },
  modeOptionBody: {
    flex: 1,
  },
  modeOptionLabel: {
    ...Type.body,
    fontFamily: 'Nunito_700Bold',
    color: Colors.text,
  },
  modeOptionLabelActive: {
    color: Colors.primary,
  },
  modeOptionSub: {
    ...Type.hint,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  modeRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
    flexShrink: 0,
  },
  modeRadioActive: {
    borderColor: Colors.primary,
  },
  modeRadioDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: Colors.primary,
  },
});
