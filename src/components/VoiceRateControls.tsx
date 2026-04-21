import React, { useEffect, useMemo, useState } from 'react';
import {
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
import { PillowChip } from './PillowChip';
import { Colors } from '../theme/colors';
import { Radii, Shadows, Spacing, Type } from '../theme/tokens';
import {
  narrationPrefs,
  NARRATION_LENGTH_VALUES,
  type NarrationLength,
} from '../services/NarrationPrefs';
import { speechService } from '../services/SpeechService';
import { humanizeVoices } from '../services/voiceLabels';
import { currentSpeechTag, getLocale, t } from '../i18n';
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
  { label: '500m', meters: 500 },
  { label: '1km', meters: 1000 },
  { label: '2km', meters: 2000 },
  { label: '5km', meters: 5000 },
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
 *   THE GUIDE      Auto-Guide · Hidden gems · Speak
 *   SEARCH AREA    Radius · Length
 *   VOICE          Rate · Voice picker
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
  radiusMeters,
  onRadiusChange,
}: Props) {
  const [rate, setRate] = useState<number>(narrationPrefs.get().rate);
  const [voice, setVoice] = useState<string | undefined>(narrationPrefs.get().voice);
  const [length, setLength] = useState<NarrationLength>(narrationPrefs.get().length);
  const availableVoices = useVoicesForLocale(visible);

  useEffect(() => {
    return narrationPrefs.subscribe((p) => {
      setRate(p.rate);
      setVoice(p.voice);
      setLength(p.length);
    });
  }, []);

  const voiceChips = useMemo(() => {
    // Replace the opaque OS identifiers ("en-us-x-iol-local") with stable,
    // friendly first names so the picker reads as a human list.
    const head: Array<{ id: string | undefined; label: string }> = [
      { id: undefined, label: t('narration.voiceSystemDefault') },
    ];
    const labeled = humanizeVoices(availableVoices).map(({ voice, label }) => ({
      id: voice.identifier,
      label,
    }));
    return [...head, ...labeled];
  }, [availableVoices]);

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
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
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
          >
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
            </SettingsGroup>

            {/* SEARCH AREA — radius + narration length */}
            <SettingsGroup label={t('settings.groupSearch')}>
              <SegmentedRow
                label={t('settings.radiusLabel')}
                options={RADIUS_OPTIONS.map((o) => o.label)}
                activeIdx={RADIUS_OPTIONS.findIndex((o) => o.meters === radiusMeters)}
                onSelect={(i) => onRadiusChange(RADIUS_OPTIONS[i].meters)}
              />
              <SegmentedRow
                label={t('settings.lengthLabel')}
                options={NARRATION_LENGTH_VALUES.map(lengthLabel)}
                activeIdx={NARRATION_LENGTH_VALUES.indexOf(length)}
                onSelect={(i) => narrationPrefs.setLength(NARRATION_LENGTH_VALUES[i])}
              />
            </SettingsGroup>

            {/* VOICE — rate slider + voice picker */}
            <SettingsGroup label={t('settings.groupVoice')}>
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
          </ScrollView>

          <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
            <Text style={styles.doneBtnText}>{t('narration.done')}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
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

function SegmentedRow({
  label,
  options,
  activeIdx,
  onSelect,
}: {
  label: string;
  options: string[];
  activeIdx: number;
  onSelect: (i: number) => void;
}) {
  return (
    <View style={styles.segmentRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
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
    maxHeight: '88%',
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xxl,
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
    flexShrink: 1,
  },
  scrollContent: {
    gap: Spacing.md,
    paddingBottom: Spacing.sm,
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
  voiceChipRow: {
    gap: 8,
    paddingVertical: 2,
  },
  emptyHint: {
    ...Type.bodySm,
    color: Colors.textTertiary,
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
});
