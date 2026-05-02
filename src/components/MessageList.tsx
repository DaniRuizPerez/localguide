import React, { forwardRef, useCallback } from 'react';
import { FlatList, type ListRenderItem, StyleSheet, Text, View } from 'react-native';
import { Colors } from '../theme/colors';
import { Type } from '../theme/tokens';
import { GuideAvatar } from './GuideAvatar';
import { AnimatedChatBubble } from './ChatBubble';
import { SuggestionChips, type Chip } from './SuggestionChips';
import { t } from '../i18n';
import type { Message } from '../types/chat';

interface Props {
  messages: Message[];
  /** Copy for the empty state — varies by whether Auto-Guide is on. */
  autoGuideEnabled: boolean;
  /**
   * Called when the user taps a suggestion chip. The cue string is the
   * pre-built follow-up query (e.g. "Tell me more about Bryant Park").
   * ChatScreen wires this into useGuideStream.stream.
   */
  onSendChip: (cue: string) => void;
}

/**
 * Derive a short topic label from a guide message.
 *
 * Priority:
 * 1. `msg.locationUsed?.placeName` when the message was tied to a named place.
 * 2. First 8 words of the message text (stripped of punctuation) — a
 *    best-effort label good enough for "Tell me more about …".
 */
function extractTopic(msg: Message): string {
  // locationUsed is either a GPSContext object (with optional placeName) or a
  // plain string (manual location). Handle both.
  if (msg.locationUsed) {
    if (typeof msg.locationUsed === 'object' && msg.locationUsed.placeName) {
      return msg.locationUsed.placeName;
    }
    if (typeof msg.locationUsed === 'string' && msg.locationUsed.trim()) {
      return msg.locationUsed.trim();
    }
  }

  // Fall back to first 8 words of the message text, punctuation stripped.
  const words = msg.text
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  return words.join(' ');
}

/**
 * Build the three default suggestion chips for a guide bubble.
 */
function buildChips(msg: Message, onSendChip: (cue: string) => void): Chip[] {
  const topic = extractTopic(msg);
  return [
    {
      label: t('chip.tellMeMore'),
      onPress: () => onSendChip(`Tell me more about ${topic}`),
    },
    {
      label: t('chip.walkMeThere'),
      onPress: () => onSendChip(`Walk me to ${topic}`),
    },
    {
      label: t('chip.foodNearby'),
      onPress: () => onSendChip('What food is good near here?'),
    },
  ];
}

export const MessageList = forwardRef<FlatList<Message>, Props>(function MessageList(
  { messages, autoGuideEnabled, onSendChip },
  ref
) {
  const renderItem: ListRenderItem<Message> = useCallback(
    ({ item }) => {
      const isGuideBubbleWithText = item.role === 'guide' && item.text.trim().length > 0;
      return (
        <>
          <AnimatedChatBubble message={item} />
          {isGuideBubbleWithText && (
            <SuggestionChips chips={buildChips(item, onSendChip)} />
          )}
        </>
      );
    },
    [onSendChip]
  );

  return (
    <FlatList
      ref={ref}
      data={messages}
      keyExtractor={(m) => m.id}
      renderItem={renderItem}
      style={styles.list}
      contentContainerStyle={styles.messageList}
      ListEmptyComponent={
        <View style={styles.emptyContainer}>
          <GuideAvatar size={48} />
          <Text style={[Type.title, styles.emptyTitle]}>
            {autoGuideEnabled ? t('chat.autoGuideListening') : t('app.ready')}
          </Text>
          <Text style={[Type.body, styles.emptyBody]}>
            {autoGuideEnabled ? t('chat.autoGuideHint') : t('chat.askHint')}
          </Text>
        </View>
      }
    />
  );
});

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  messageList: {
    padding: 14,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 12,
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 60,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    color: Colors.text,
    marginTop: 16,
    textAlign: 'center',
  },
  emptyBody: {
    color: Colors.textSecondary,
    marginTop: 6,
    textAlign: 'center',
  },
});
