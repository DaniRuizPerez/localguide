import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '../theme/colors';
import { Radii, Shadows, Spacing, Type } from '../theme/tokens';
import { useSpeechState } from '../hooks/useSpeechState';
import { speechService } from '../services/SpeechService';
import { t } from '../i18n';

// Appears only while narration is active (speaking) or paused. Offers
// play/pause/skip/stop controls over the shared SpeechService queue.
export function PlaybackControls() {
  const { isSpeaking, isPaused, queueLength } = useSpeechState();

  const visible = isSpeaking || isPaused;
  if (!visible) return null;

  return (
    <View style={styles.container} accessibilityRole="toolbar">
      {isPaused ? (
        <TouchableOpacity
          style={[styles.btn, styles.primaryBtn]}
          onPress={() => speechService.resume()}
          accessibilityLabel={t('narration.resume')}
        >
          <Text style={[styles.glyph, styles.primaryGlyph]}>▶</Text>
          <Text style={[Type.chip, styles.primaryLabel]}>{t('narration.resume')}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.btn, styles.secondaryBtn]}
          onPress={() => speechService.pause()}
          accessibilityLabel={t('narration.pause')}
        >
          <Text style={styles.glyph}>⏸</Text>
          <Text style={[Type.chip, styles.label]}>{t('narration.pause')}</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[styles.btn, styles.secondaryBtn, queueLength === 0 && styles.disabled]}
        onPress={() => speechService.skipCurrent()}
        disabled={queueLength === 0}
        accessibilityLabel={t('narration.skip')}
      >
        <Text style={styles.glyph}>⏭</Text>
        <Text style={[Type.chip, styles.label]}>{t('narration.skip')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.btn, styles.stopBtn]}
        onPress={() => speechService.stop()}
        accessibilityLabel={t('chat.stop')}
      >
        <Text style={[styles.glyph, styles.stopGlyph]}>■</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: Colors.background,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radii.md,
    borderWidth: 1,
  },
  primaryBtn: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
    ...Shadows.chipActiveHard,
  },
  secondaryBtn: {
    backgroundColor: Colors.surface,
    borderColor: Colors.borderLight,
    ...Shadows.softOutset,
  },
  stopBtn: {
    backgroundColor: Colors.error,
    borderColor: Colors.error,
    marginLeft: 'auto',
    paddingHorizontal: 10,
  },
  disabled: {
    opacity: 0.4,
  },
  glyph: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  primaryGlyph: {
    color: '#FFFFFF',
  },
  stopGlyph: {
    color: '#FFFFFF',
    fontSize: 10,
    lineHeight: 12,
  },
  label: {
    color: Colors.textSecondary,
  },
  primaryLabel: {
    color: '#FFFFFF',
  },
  heading: {
    ...Type.metaUpper,
    color: Colors.textTertiary,
    marginRight: Spacing.sm,
  },
});
