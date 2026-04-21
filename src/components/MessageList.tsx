import React, { forwardRef, useCallback } from 'react';
import { FlatList, type ListRenderItem, StyleSheet, Text, View } from 'react-native';
import { Colors } from '../theme/colors';
import { Type } from '../theme/tokens';
import { GuideAvatar } from './GuideAvatar';
import { AnimatedChatBubble } from './ChatBubble';
import { t } from '../i18n';
import type { Message } from '../types/chat';

interface Props {
  messages: Message[];
  /** Copy for the empty state — varies by whether Auto-Guide is on. */
  autoGuideEnabled: boolean;
}

export const MessageList = forwardRef<FlatList<Message>, Props>(function MessageList(
  { messages, autoGuideEnabled },
  ref
) {
  const renderItem: ListRenderItem<Message> = useCallback(
    ({ item }) => <AnimatedChatBubble message={item} />,
    []
  );

  return (
    <FlatList
      ref={ref}
      data={messages}
      keyExtractor={(m) => m.id}
      renderItem={renderItem}
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
