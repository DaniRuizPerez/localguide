import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Colors } from '../theme/colors';
import { Radii, Shadows } from '../theme/tokens';
import { t } from '../i18n';

interface Props {
  input: string;
  onChangeInput: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  onCameraPress: () => void;
  onMicToggle: () => void;
  inferring: boolean;
  isListening: boolean;
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
}: Props) {
  return (
    <View style={styles.inputRowWrap}>
      <View style={styles.inputCapsule}>
        <TouchableOpacity
          style={[styles.iconBtn, isListening && styles.micBtnActive]}
          onPress={onMicToggle}
          disabled={inferring}
        >
          <Text style={styles.iconGlyph}>{isListening ? '⏹' : '🎤'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.iconBtn} onPress={onCameraPress} disabled={inferring}>
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

const styles = StyleSheet.create({
  inputRowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 14,
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
});
