import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { PillowChip } from './PillowChip';
import { NarrationLengthPicker } from './NarrationLengthPicker';
import { Colors } from '../theme/colors';
import { Radii, Shadows, Spacing, Type } from '../theme/tokens';
import { narrationPrefs } from '../services/NarrationPrefs';
import { speechService } from '../services/SpeechService';
import { currentSpeechTag, getLocale, t } from '../i18n';
import type * as SpeechModule from 'expo-speech';

type Voice = SpeechModule.Voice;

interface Props {
  visible: boolean;
  onClose: () => void;
}

const RATE_MIN = 0.6;
const RATE_MAX = 1.6;
const RATE_STEP = 0.05;

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
        // Prefer voices whose language matches the speech tag exactly, then
        // the 2-letter language. That keeps the list short and relevant —
        // typical Android devices expose 30+ voices.
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

export function VoiceRateControls({ visible, onClose }: Props) {
  const [rate, setRate] = useState<number>(narrationPrefs.get().rate);
  const [voice, setVoice] = useState<string | undefined>(narrationPrefs.get().voice);
  const availableVoices = useVoicesForLocale(visible);

  useEffect(() => {
    return narrationPrefs.subscribe((p) => {
      setRate(p.rate);
      setVoice(p.voice);
    });
  }, []);

  const voiceChips = useMemo(() => {
    // Always include a "System default" option so users can clear a custom pick.
    const head: Array<{ id: string | undefined; label: string }> = [
      { id: undefined, label: t('narration.voiceSystemDefault') },
    ];
    const rest = availableVoices.map((v) => ({
      id: v.identifier,
      label: v.name || v.identifier,
    }));
    return [...head, ...rest];
  }, [availableVoices]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.heading}>{t('narration.settingsTitle')}</Text>

          <Text style={styles.sectionLabel}>{t('narration.lengthSection')}</Text>
          <NarrationLengthPicker style={styles.lengthPicker} />

          <Text style={styles.sectionLabel}>
            {t('narration.rateLabel')} · {formatRate(rate)}
          </Text>
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

          <Text style={styles.sectionLabel}>{t('narration.voiceLabel')}</Text>
          {voiceChips.length === 1 ? (
            <Text style={styles.emptyHint}>{t('narration.voiceNoneAvailable')}</Text>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.voiceRow}
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

          <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
            <Text style={styles.doneBtnText}>{t('narration.done')}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
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
  heading: {
    ...Type.h1,
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  sectionLabel: {
    ...Type.metaUpper,
    color: Colors.textSecondary,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  lengthPicker: {
    marginHorizontal: -Spacing.lg,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  voiceRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: Spacing.xs,
  },
  emptyHint: {
    ...Type.bodySm,
    color: Colors.textTertiary,
    paddingVertical: Spacing.sm,
  },
  doneBtn: {
    marginTop: Spacing.lg,
    alignSelf: 'stretch',
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
