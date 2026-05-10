import React, { forwardRef, useCallback, useMemo } from 'react';
import { FlatList, Image, type ListRenderItem, StyleSheet, Text, View } from 'react-native';
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
   * Called when the user taps a suggestion chip.
   * @param displayText - The short, human-friendly string shown in the user bubble.
   * @param promptText  - The full programmatic instruction sent to the LLM.
   * ChatScreen wires promptText into useGuideStream.stream while displayText
   * goes to addUserMessage, so the transcript stays clean.
   */
  onSendChip: (displayText: string, promptText: string) => void;
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
 *
 * The chip passes two strings to onSendChip:
 *  - displayText: short label shown in the user bubble ("Tell me more about X")
 *  - promptText:  full programmatic instruction sent to the LLM
 */
function buildChips(
  msg: Message,
  allMessages: Message[],
  onSendChip: (displayText: string, promptText: string) => void
): Chip[] {
  const topic = extractTopic(msg, allMessages);
  const displayText = `Tell me more about ${topic}`;
  const promptText = `Tell me more about ${topic}. Give a long, detailed answer with specific facts (history, architecture, people, traditions, the "why"). Do NOT repeat what you already said — assume the prior reply was read. Add new material.`;
  return [
    {
      label: t('chip.tellMeMore'),
      onPress: () => onSendChip(displayText, promptText),
    },
  ];
}

export const MessageList = forwardRef<FlatList<Message>, Props>(function MessageList(
  { messages, autoGuideEnabled, onSendChip },
  ref
) {
  // Empty guide placeholders are filtered out of the FlatList data (not just
  // returned-null in renderItem). FlatList still reserves cell space + the
  // `gap: 12` between items for null-rendered cells; with scrollToEnd that
  // leaves a blank viewport — the user sees an empty-but-scrollable surface
  // until tokens land. ChatScreen's <TypingIndicator /> already covers the
  // streaming state visually.
  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (m) => !(m.role === 'guide' && m.text.trim().length === 0 && !m.imageUri)
      ),
    [messages]
  );

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
      data={visibleMessages}
      keyExtractor={(m) => m.id}
      renderItem={renderItem}
      style={styles.list}
      contentContainerStyle={styles.messageList}
      ListEmptyComponent={
        <View style={styles.emptyContainer}>
          <Image
            source={require('../../assets/canyon/canyon-180.png')}
            style={styles.emptyIcon}
            accessibilityIgnoresInvertColors
          />
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
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 16,
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
