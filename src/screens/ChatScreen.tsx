import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ListRenderItem,
} from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { RootTabParamList } from '../navigation/AppNavigator';
import { useLocation } from '../hooks/useLocation';
import { localGuideService } from '../services/LocalGuideService';
import type { GPSContext } from '../services/InferenceService';

type Props = BottomTabScreenProps<RootTabParamList, 'Chat'>;

interface Message {
  id: string;
  role: 'user' | 'guide';
  text: string;
  locationUsed?: GPSContext;
  durationMs?: number;
}

function LocationBanner({
  status,
  gps,
  errorMessage,
  onRefresh,
}: {
  status: string;
  gps: GPSContext | null;
  errorMessage: string | null;
  onRefresh: () => void;
}) {
  if (status === 'ready' && gps) {
    return (
      <View style={styles.bannerReady}>
        <Text style={styles.bannerText}>
          📍 {gps.latitude.toFixed(4)}, {gps.longitude.toFixed(4)}
          {gps.accuracy != null ? `  ±${Math.round(gps.accuracy)}m` : ''}
        </Text>
      </View>
    );
  }
  if (status === 'requesting') {
    return (
      <View style={styles.bannerLoading}>
        <ActivityIndicator size="small" color="#007AFF" />
        <Text style={[styles.bannerText, { marginLeft: 6 }]}>Getting location…</Text>
      </View>
    );
  }
  if (status === 'denied' || status === 'error') {
    return (
      <TouchableOpacity style={styles.bannerError} onPress={onRefresh}>
        <Text style={styles.bannerErrorText}>{errorMessage ?? 'Location unavailable'} — tap to retry</Text>
      </TouchableOpacity>
    );
  }
  return null;
}

function ChatBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  return (
    <View style={[styles.bubbleRow, isUser ? styles.bubbleRowUser : styles.bubbleRowGuide]}>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleGuide]}>
        <Text style={[styles.bubbleText, isUser ? styles.bubbleTextUser : styles.bubbleTextGuide]}>
          {message.text}
        </Text>
        {message.durationMs != null && (
          <Text style={styles.bubbleMeta}>{message.durationMs}ms · on-device</Text>
        )}
      </View>
    </View>
  );
}

export default function ChatScreen(_props: Props) {
  const { gps, status, errorMessage, refresh } = useLocation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [inferring, setInferring] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);

  const sendMessage = useCallback(async () => {
    const query = input.trim();
    if (!query || inferring) return;
    if (!gps) {
      setMessages((prev) => [
        ...prev,
        {
          id: String(Date.now()) + '-err',
          role: 'guide',
          text: 'Location not available yet. Please wait or tap the banner to retry.',
        },
      ]);
      return;
    }

    const userMsg: Message = { id: String(Date.now()), role: 'user', text: query };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setInferring(true);

    try {
      const response = await localGuideService.ask(query, gps);
      const guideMsg: Message = {
        id: String(Date.now()) + '-g',
        role: 'guide',
        text: response.text,
        locationUsed: response.locationUsed,
        durationMs: response.durationMs,
      };
      setMessages((prev) => [...prev, guideMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: String(Date.now()) + '-err',
          role: 'guide',
          text: 'Sorry, something went wrong. Please try again.',
        },
      ]);
    } finally {
      setInferring(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [input, inferring, gps]);

  const renderItem: ListRenderItem<Message> = useCallback(
    ({ item }) => <ChatBubble message={item} />,
    []
  );

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={88}
    >
      <LocationBanner
        status={status}
        gps={gps}
        errorMessage={errorMessage}
        onRefresh={refresh}
      />

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        contentContainerStyle={styles.messageList}
        ListEmptyComponent={
          <Text style={styles.emptyHint}>
            Ask your local guide anything about what's around you.
          </Text>
        }
      />

      {inferring && (
        <View style={styles.typingRow}>
          <ActivityIndicator size="small" color="#007AFF" />
          <Text style={styles.typingText}>Guide is thinking…</Text>
        </View>
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ask about nearby places…"
          placeholderTextColor="#8E8E93"
          returnKeyType="send"
          onSubmitEditing={sendMessage}
          editable={!inferring}
          multiline={false}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || inferring) && styles.sendBtnDisabled]}
          onPress={sendMessage}
          disabled={!input.trim() || inferring}
        >
          <Text style={styles.sendBtnText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F2F7' },
  bannerReady: {
    backgroundColor: '#E8F5E9',
    paddingVertical: 6,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  bannerLoading: {
    backgroundColor: '#E3F2FD',
    paddingVertical: 6,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  bannerError: {
    backgroundColor: '#FFEBEE',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  bannerText: { fontSize: 12, color: '#2E7D32' },
  bannerErrorText: { fontSize: 12, color: '#C62828' },
  messageList: { padding: 12, paddingBottom: 8 },
  emptyHint: {
    textAlign: 'center',
    color: '#8E8E93',
    marginTop: 80,
    fontSize: 15,
    paddingHorizontal: 32,
  },
  bubbleRow: { marginVertical: 4, flexDirection: 'row' },
  bubbleRowUser: { justifyContent: 'flex-end' },
  bubbleRowGuide: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '80%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  bubbleUser: { backgroundColor: '#007AFF', borderBottomRightRadius: 4 },
  bubbleGuide: { backgroundColor: '#FFFFFF', borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  bubbleTextUser: { color: '#FFFFFF' },
  bubbleTextGuide: { color: '#1C1C1E' },
  bubbleMeta: { fontSize: 10, color: '#8E8E93', marginTop: 3 },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  typingText: { marginLeft: 6, fontSize: 13, color: '#8E8E93' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#C6C6C8',
  },
  input: {
    flex: 1,
    backgroundColor: '#F2F2F7',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 15,
    color: '#1C1C1E',
    marginRight: 8,
  },
  sendBtn: {
    backgroundColor: '#007AFF',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sendBtnDisabled: { backgroundColor: '#C7C7CC' },
  sendBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 15 },
});
