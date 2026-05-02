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
 * Derive the POI / topic that a guide bubble is about by reading the user
 * message that PROMPTED it, not the bubble's own GPS placeName. Otherwise a
 * reply about "Stanford" tied to a Palo Alto GPS fix would surface "Tell me
 * more about Palo Alto" — wrong POI.
 *
 * Strategy:
 * 1. Find the most recent prior user message.
 * 2. Strip leading "Tell me about ", "What is ", "Tell me more about ",
 *    "About ", "Walk me to " etc., then trim trailing punctuation.
 * 3. Fall back to the guide bubble's placeName, then to the first 8 words of
 *    its text — only if no prior user message exists (e.g. auto-guide cue).
 */
function extractTopic(msg: Message, allMessages: Message[]): string {
  const idx = allMessages.findIndex((m) => m.id === msg.id);
  for (let i = idx - 1; i >= 0; i--) {
    const prev = allMessages[i];
    if (prev.role === 'user' && prev.text.trim()) {
      return cleanQueryToTopic(prev.text);
    }
  }
  if (msg.locationUsed) {
    if (typeof msg.locationUsed === 'object' && msg.locationUsed.placeName) {
      return msg.locationUsed.placeName;
    }
    if (typeof msg.locationUsed === 'string' && msg.locationUsed.trim()) {
      return msg.locationUsed.trim();
    }
  }
  const words = msg.text
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  return words.join(' ');
}

const TOPIC_PREFIX_RE =
  /^\s*(tell me more about|tell me about|what(?:'s| is)|who(?:'s| is)|where(?:'s| is)|about|walk me to|narrate|describe)\s+/i;

function cleanQueryToTopic(query: string): string {
  let topic = query.trim();
  // Peel off question-style prefixes a couple of times so "Tell me about Stanford" → "Stanford".
  for (let i = 0; i < 2; i++) {
    const next = topic.replace(TOPIC_PREFIX_RE, '');
    if (next === topic) break;
    topic = next;
  }
  // Strip trailing punctuation and quote marks.
  topic = topic.replace(/[.?!,;:'"`]+$/g, '').trim();
  return topic || query.trim();
}

/**
 * Build the suggestion chips for a guide bubble. Currently a single chip —
 * "Tell me more" — that re-prompts the model for a fuller, non-repetitive
 * expansion of the same POI. Earlier "Walk me there / Food nearby" chips
 * were removed: too generic, drove off-topic follow-ups.
 */
function buildChips(
  msg: Message,
  allMessages: Message[],
  onSendChip: (cue: string) => void
): Chip[] {
  const topic = extractTopic(msg, allMessages);
  return [
    {
      label: t('chip.tellMeMore'),
      onPress: () =>
        onSendChip(
          `Tell me more about ${topic}. Give a long, detailed answer with specific facts (history, architecture, people, traditions, the "why"). Do NOT repeat what you already said — assume the prior reply was read. Add new material.`
        ),
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
            <SuggestionChips chips={buildChips(item, messages, onSendChip)} />
          )}
        </>
      );
    },
    [onSendChip, messages]
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
