import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../theme/colors';
import { Radii, Shadows, Type } from '../theme/tokens';
import { t } from '../i18n';

const MIC_TOOLTIP_KEY = '@localguide/mic-tooltip-seen-v1';
const TOOLTIP_AUTO_DISMISS_MS = 5000;

interface Props {
  input: string;
  onChangeInput: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  onCameraPress: () => void;
  onMicToggle: () => void;
  inferring: boolean;
  isListening: boolean;
  /** When true, renders the camera icon at 50% opacity and announces the
   *  denied state via accessibilityLabel so VoiceOver / TalkBack users
   *  understand that tapping will open Settings, not the camera. */
  cameraPermissionDenied?: boolean;
}

export function ChatInputBar({
  input,
  onChangeInput,
  onSend,
  onStop,
  onCameraPress,
  onMicToggle,
  inferring,
  isListening,
  cameraPermissionDenied = false,
}: Props) {
  // On Android with gesture-nav the system bar overlays the View; without
  // adding the bottom inset to paddingBottom the mic / camera / send row
  // sits underneath the gesture indicator and the chat-input bar visually
  // disappears on shorter devices (Pixel 3, etc).
  const insets = useSafeAreaInsets();

  // ── Mic tooltip state ─────────────────────────────────────────────────────
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(MIC_TOOLTIP_KEY).then((val) => {
      if (val === null) {
        setShowTooltip(true);
        tooltipTimerRef.current = setTimeout(() => {
          dismissTooltip();
        }, TOOLTIP_AUTO_DISMISS_MS);
      }
    });
    return () => {
      if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dismiss when the user types anything.
  useEffect(() => {
    if (input.length > 0 && showTooltip) {
      dismissTooltip();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  function dismissTooltip() {
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
    setShowTooltip(false);
    AsyncStorage.setItem(MIC_TOOLTIP_KEY, '1');
  }

  const handleMicToggle = () => {
    if (showTooltip) dismissTooltip();
    onMicToggle();
  };

  return (
    <View style={[styles.inputRowWrap, { paddingBottom: INPUT_ROW_BASE_PADDING_BOTTOM + insets.bottom }]}>
      <View style={styles.inputCapsule}>
        {/* Mic button wrapper — needed to anchor the tooltip absolutely */}
        <View>
          <TouchableOpacity
            style={[styles.iconBtn, isListening && styles.micBtnActive]}
            onPress={handleMicToggle}
            disabled={inferring}
          >
            <Text style={styles.iconGlyph}>{isListening ? '⏹' : '🎤'}</Text>
          </TouchableOpacity>

          {showTooltip && (
            <View style={styles.tooltipContainer} pointerEvents="none">
              <View style={styles.tooltipBubble}>
                <Text style={[Type.chip, styles.tooltipText]}>
                  Tap to ask by voice 🎤
                </Text>
              </View>
              {/* Caret pointing down toward the mic button */}
              <View style={styles.caretOuter} />
              <View style={styles.caretInner} />
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[styles.iconBtn, cameraPermissionDenied && styles.cameraBtnDenied]}
          onPress={onCameraPress}
          disabled={inferring}
          accessibilityLabel={
            cameraPermissionDenied
              ? 'Camera permission denied — tap to open settings'
              : t('chat.identifyThis')
          }
          testID="camera-btn"
        >
          <Text style={styles.iconGlyph}>📷</Text>
        </TouchableOpacity>

        <TextInput
          style={styles.input}
          value={input}
          onChangeText={onChangeInput}
          placeholder={isListening ? t('chat.listening') : t('chat.placeholder')}
          placeholderTextColor={Colors.textTertiary}
          returnKeyType="send"
          onSubmitEditing={onSend}
          editable={!inferring && !isListening}
          multiline={false}
        />
        {inferring ? (
          <TouchableOpacity
            style={[styles.sendBtn, styles.stopBtn]}
            onPress={onStop}
            accessibilityLabel="Stop generating"
          >
            <Text style={styles.sendBtnText}>■</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.sendBtn, !input.trim() && styles.sendBtnDisabled]}
            onPress={onSend}
            disabled={!input.trim()}
            accessibilityLabel="Send"
          >
            <Text style={styles.sendBtnText}>↑</Text>
          </TouchableOpacity>
        )}
      </View>
      {inferring && <ActivityIndicator size="small" color={Colors.secondary} style={styles.spinner} />}
    </View>
  );
}

const INPUT_ROW_BASE_PADDING_BOTTOM = 14;

// Tooltip geometry: bubble sits above the mic button, caret points down.
const CARET_SIZE = 6;

const styles = StyleSheet.create({
  inputRowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: INPUT_ROW_BASE_PADDING_BOTTOM,
    backgroundColor: Colors.background,
  },
  inputCapsule: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radii.xl,
    paddingLeft: 8,
    paddingRight: 6,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: 4,
    ...Shadows.softOutset,
  },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBtnDenied: {
    opacity: 0.5,
  },
  micBtnActive: {
    backgroundColor: Colors.error,
  },
  iconGlyph: { fontSize: 14 },
  input: {
    flex: 1,
    paddingHorizontal: 6,
    paddingVertical: 8,
    fontSize: 13,
    color: Colors.text,
  },
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 3,
  },
  sendBtnDisabled: {
    backgroundColor: Colors.disabled,
    shadowOpacity: 0,
    elevation: 0,
  },
  stopBtn: {
    backgroundColor: Colors.error,
    shadowColor: '#7F2424',
  },
  sendBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
    lineHeight: 18,
  },
  spinner: { marginLeft: 8 },

  // ── Mic tooltip ───────────────────────────────────────────────────────────
  // Container is absolutely positioned relative to the mic View wrapper.
  // left: -30 centres the 160px bubble over the 30px mic button.
  // bottom: 38 clears the 30px button + 8px gap.
  tooltipContainer: {
    position: 'absolute',
    left: -30,
    bottom: 38,
    width: 160,
    alignItems: 'center',
    zIndex: 200,
  },
  tooltipBubble: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: Radii.md,
    paddingHorizontal: 10,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 4,
  },
  tooltipText: {
    color: Colors.text,
    textAlign: 'center',
  },
  // Two overlapping border-trick triangles forming a bordered downward caret.
  // caretOuter is the border colour; caretInner is the fill colour (surface).
  caretOuter: {
    width: 0,
    height: 0,
    borderLeftWidth: CARET_SIZE,
    borderRightWidth: CARET_SIZE,
    borderTopWidth: CARET_SIZE,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: Colors.borderLight,
    zIndex: 201,
  },
  caretInner: {
    position: 'absolute',
    bottom: -(CARET_SIZE - 2),
    width: 0,
    height: 0,
    borderLeftWidth: CARET_SIZE - 1,
    borderRightWidth: CARET_SIZE - 1,
    borderTopWidth: CARET_SIZE - 1,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: Colors.surface,
    zIndex: 202,
  },
});
