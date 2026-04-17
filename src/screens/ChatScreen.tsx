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
  Switch,
  Image,
  Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { RootTabParamList } from '../navigation/AppNavigator';
import { useLocation } from '../hooks/useLocation';
import { useAutoGuide } from '../hooks/useAutoGuide';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { localGuideService } from '../services/LocalGuideService';
import { speechService } from '../services/SpeechService';
import type { GPSContext } from '../services/InferenceService';

type Props = BottomTabScreenProps<RootTabParamList, 'Chat'>;

interface Message {
  id: string;
  role: 'user' | 'guide';
  text: string;
  imageUri?: string;
  locationUsed?: GPSContext | string;
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
        {message.imageUri && (
          <Image
            source={{ uri: message.imageUri }}
            style={styles.bubbleImage}
            resizeMode="cover"
          />
        )}
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
  const [speakResponses, setSpeakResponses] = useState(true);
  const listRef = useRef<FlatList<Message>>(null);

  const scrollToEnd = useCallback(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  const addGuideMessage = useCallback((text: string, locationUsed: GPSContext, durationMs?: number) => {
    const msg: Message = {
      id: String(Date.now()) + '-auto',
      role: 'guide',
      text,
      locationUsed,
      durationMs,
    };
    setMessages((prev) => [...prev, msg]);
    scrollToEnd();
  }, [scrollToEnd]);

  const autoGuide = useAutoGuide((text, autoGps) => {
    addGuideMessage(text, autoGps);
  });

  const handleVoiceResult = useCallback(
    async (transcript: string) => {
      const effectiveGps = gps ?? autoGuide.latestGps;
      if (!effectiveGps) return;

      const userMsg: Message = { id: String(Date.now()), role: 'user', text: transcript };
      setMessages((prev) => [...prev, userMsg]);
      setInferring(true);

      try {
        const response = await localGuideService.ask(transcript, effectiveGps);
        const guideMsg: Message = {
          id: String(Date.now()) + '-g',
          role: 'guide',
          text: response.text,
          locationUsed: response.locationUsed,
          durationMs: response.durationMs,
        };
        setMessages((prev) => [...prev, guideMsg]);
        if (speakResponses) {
          speechService.speak(response.text);
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          { id: String(Date.now()) + '-err', role: 'guide', text: 'Sorry, something went wrong.' },
        ]);
      } finally {
        setInferring(false);
        scrollToEnd();
      }
    },
    [gps, autoGuide.latestGps, speakResponses, scrollToEnd]
  );

  const voice = useVoiceInput(handleVoiceResult);

  const sendMessage = useCallback(async () => {
    const query = input.trim();
    if (!query || inferring) return;
    const effectiveGps = gps ?? autoGuide.latestGps;
    if (!effectiveGps) {
      setMessages((prev) => [
        ...prev,
        { id: String(Date.now()) + '-err', role: 'guide', text: 'Location not available yet. Please wait or tap the banner to retry.' },
      ]);
      return;
    }

    const userMsg: Message = { id: String(Date.now()), role: 'user', text: query };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setInferring(true);

    try {
      const response = await localGuideService.ask(query, effectiveGps);
      const guideMsg: Message = {
        id: String(Date.now()) + '-g',
        role: 'guide',
        text: response.text,
        locationUsed: response.locationUsed,
        durationMs: response.durationMs,
      };
      setMessages((prev) => [...prev, guideMsg]);
      if (speakResponses) {
        speechService.speak(response.text);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: String(Date.now()) + '-err', role: 'guide', text: 'Sorry, something went wrong. Please try again.' },
      ]);
    } finally {
      setInferring(false);
      scrollToEnd();
    }
  }, [input, inferring, gps, autoGuide.latestGps, speakResponses, scrollToEnd]);

  const takePicture = useCallback(async () => {
    if (inferring) return;
    const effectiveGps = gps ?? autoGuide.latestGps;
    if (!effectiveGps) {
      Alert.alert('No Location', 'Location not available yet. Please wait for GPS lock.');
      return;
    }

    const { status: camStatus } = await ImagePicker.requestCameraPermissionsAsync();
    if (camStatus !== 'granted') {
      Alert.alert('Camera Permission', 'Camera access is required to take photos.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: false,
    });

    if (result.canceled || !result.assets?.[0]) return;

    const imageUri = result.assets[0].uri;
    const userQuery = input.trim();

    const userMsg: Message = {
      id: String(Date.now()),
      role: 'user',
      text: userQuery || 'What do you see here?',
      imageUri,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setInferring(true);
    scrollToEnd();

    try {
      const response = await localGuideService.askWithImage(userQuery, effectiveGps);
      const guideMsg: Message = {
        id: String(Date.now()) + '-g',
        role: 'guide',
        text: response.text,
        locationUsed: response.locationUsed,
        durationMs: response.durationMs,
      };
      setMessages((prev) => [...prev, guideMsg]);
      if (speakResponses) {
        speechService.speak(response.text);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: String(Date.now()) + '-err', role: 'guide', text: 'Sorry, something went wrong. Please try again.' },
      ]);
    } finally {
      setInferring(false);
      scrollToEnd();
    }
  }, [inferring, gps, autoGuide.latestGps, input, speakResponses, scrollToEnd]);

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
      <LocationBanner status={status} gps={gps} errorMessage={errorMessage} onRefresh={refresh} />

      <View style={styles.controlsRow}>
        <View style={styles.controlItem}>
          <Text style={styles.controlLabel}>Auto-Guide</Text>
          <Switch
            value={autoGuide.enabled}
            onValueChange={autoGuide.toggle}
            trackColor={{ true: '#34C759' }}
          />
        </View>
        <View style={styles.controlItem}>
          <Text style={styles.controlLabel}>Speak</Text>
          <Switch
            value={speakResponses}
            onValueChange={setSpeakResponses}
            trackColor={{ true: '#007AFF' }}
          />
        </View>
        {autoGuide.enabled && autoGuide.isSpeaking && (
          <TouchableOpacity style={styles.stopSpeakBtn} onPress={() => speechService.stop()}>
            <Text style={styles.stopSpeakText}>Stop</Text>
          </TouchableOpacity>
        )}
      </View>

      {autoGuide.error && (
        <View style={styles.bannerError}>
          <Text style={styles.bannerErrorText}>{autoGuide.error}</Text>
        </View>
      )}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        contentContainerStyle={styles.messageList}
        ListEmptyComponent={
          <Text style={styles.emptyHint}>
            {autoGuide.enabled
              ? 'Auto-guide active. Walk around and your guide will speak when something interesting is nearby.'
              : "Ask your local guide anything about what's around you, tap 📷 to take a photo, or enable Auto-Guide."}
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
        <TouchableOpacity
          style={[styles.micBtn, voice.isListening && styles.micBtnActive]}
          onPress={voice.isListening ? voice.stopListening : voice.startListening}
          disabled={inferring}
        >
          <Text style={styles.micBtnText}>{voice.isListening ? '⏹' : '🎤'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.cameraBtn}
          onPress={takePicture}
          disabled={inferring}
        >
          <Text style={styles.micBtnText}>📷</Text>
        </TouchableOpacity>

        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={voice.isListening ? 'Listening…' : 'Ask about nearby places…'}
          placeholderTextColor="#8E8E93"
          returnKeyType="send"
          onSubmitEditing={sendMessage}
          editable={!inferring && !voice.isListening}
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
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#C6C6C8',
  },
  controlItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
  },
  controlLabel: {
    fontSize: 13,
    color: '#3C3C43',
    marginRight: 6,
  },
  stopSpeakBtn: {
    backgroundColor: '#FF3B30',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  stopSpeakText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
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
  bubbleImage: {
    width: 200,
    height: 150,
    borderRadius: 10,
    marginBottom: 6,
  },
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
  micBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  micBtnActive: {
    backgroundColor: '#FF3B30',
  },
  cameraBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  micBtnText: { fontSize: 20 },
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
