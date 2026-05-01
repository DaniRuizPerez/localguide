import React, { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';
import { Colors } from '../theme/colors';
import { Radii, Shadows, Sizing, Type } from '../theme/tokens';
import { GuideAvatar } from './GuideAvatar';
import { t } from '../i18n';
import type { Message } from '../types/chat';
import { SourceBadge } from './SourceBadge';

export function AnimatedChatBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 80, friction: 10, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  return (
    <Animated.View
      style={[
        styles.bubbleRow,
        isUser ? styles.bubbleRowUser : styles.bubbleRowGuide,
        { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
      ]}
    >
      {!isUser && (
        <View style={styles.avatarWrap}>
          <GuideAvatar size={32} />
        </View>
      )}
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleGuide]}>
        {message.imageUri && (
          <Image source={{ uri: message.imageUri }} style={styles.bubbleImage} resizeMode="cover" />
        )}
        <Text style={[isUser ? styles.bubbleTextUser : styles.bubbleTextGuide]}>{message.text}</Text>
        {!isUser && (message.durationMs != null || message.source != null) && (
          <View style={styles.bubbleFooter}>
            {message.durationMs != null && (
              <Text style={styles.bubbleMeta}>
                {message.durationMs}MS · {t('chat.onDevice')}
              </Text>
            )}
            {message.source != null && <SourceBadge source={message.source} />}
          </View>
        )}
        {isUser && message.durationMs != null && (
          <Text style={styles.bubbleMeta}>
            {message.durationMs}MS · {t('chat.onDevice')}
          </Text>
        )}
      </View>
    </Animated.View>
  );
}

export function TypingIndicator() {
  const d1 = useRef(new Animated.Value(0.4)).current;
  const d2 = useRef(new Animated.Value(0.4)).current;
  const d3 = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const make = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.4, duration: 300, useNativeDriver: true }),
        ])
      );
    const a = make(d1, 0);
    const b = make(d2, 150);
    const c = make(d3, 300);
    a.start();
    b.start();
    c.start();
    return () => {
      a.stop();
      b.stop();
      c.stop();
    };
  }, [d1, d2, d3]);

  return (
    <View style={styles.bubbleRow}>
      <View style={styles.avatarWrap}>
        <GuideAvatar size={32} />
      </View>
      <View style={[styles.bubble, styles.bubbleGuide, styles.typingRow]}>
        <Animated.View style={[styles.typingDot, { opacity: d1 }]} />
        <Animated.View style={[styles.typingDot, { opacity: d2 }]} />
        <Animated.View style={[styles.typingDot, { opacity: d3 }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 10,
  },
  bubbleRowUser: { justifyContent: 'flex-end' },
  bubbleRowGuide: { justifyContent: 'flex-start' },
  avatarWrap: { marginRight: 8 },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  bubbleUser: {
    backgroundColor: Colors.primary,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 4,
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 2, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 3,
  },
  bubbleGuide: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 18,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.softOutset,
  },
  bubbleImage: {
    // ~56% of viewport width with a 4:3 aspect → adapts to phone size while
    // keeping a sensible thumbnail proportion regardless of device.
    width: Sizing.vw(56),
    height: Sizing.vw(42),
    borderRadius: Radii.md,
    marginBottom: 8,
  },
  bubbleTextUser: {
    ...Type.body,
    color: '#FFFFFF',
  },
  bubbleTextGuide: {
    ...Type.body,
    color: Colors.text,
  },
  bubbleFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 6,
    gap: 6,
  },
  bubbleMeta: {
    ...Type.metaUpper,
    color: Colors.textTertiary,
    opacity: 0.9,
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary,
  },
});
