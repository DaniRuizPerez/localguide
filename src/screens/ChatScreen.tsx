import React, { useState, useRef, useCallback, useEffect } from 'react';
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
  Animated,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { RootTabParamList } from '../navigation/AppNavigator';
import { useLocation } from '../hooks/useLocation';
import { useAutoGuide } from '../hooks/useAutoGuide';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { localGuideService } from '../services/LocalGuideService';
import { speechService } from '../services/SpeechService';
import { SpeechChunker } from '../services/SpeechChunker';
import type { GPSContext, StreamHandle } from '../services/InferenceService';
import { Colors } from '../theme/colors';

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
  manualLocation,
  onSetManualLocation,
}: {
  status: string;
  gps: GPSContext | null;
  errorMessage: string | null;
  onRefresh: () => void;
  manualLocation: string | null;
  onSetManualLocation: (placeName: string) => void;
}) {
  const [locationInput, setLocationInput] = useState('');

  if (status === 'ready' && gps) {
    return (
      <View style={styles.bannerReady}>
        <Text style={styles.bannerReadyText}>
          📍 {gps.latitude.toFixed(4)}, {gps.longitude.toFixed(4)}
          {gps.accuracy != null ? `  ±${Math.round(gps.accuracy)}m` : ''}
        </Text>
      </View>
    );
  }
  if (status === 'requesting') {
    return (
      <View style={styles.bannerLoading}>
        <ActivityIndicator size="small" color={Colors.primary} />
        <Text style={[styles.bannerLoadingText, { marginLeft: 6 }]}>Getting location…</Text>
      </View>
    );
  }
  if (status === 'denied' || status === 'error') {
    if (manualLocation) {
      return (
        <TouchableOpacity style={styles.bannerManual} onPress={() => onSetManualLocation('')}>
          <Text style={styles.bannerManualText}>📍 {manualLocation} — tap to change</Text>
        </TouchableOpacity>
      );
    }
    return (
      <View style={styles.bannerErrorFallback}>
        <Text style={styles.bannerErrorText}>GPS unavailable — enter a location to continue:</Text>
        <View style={styles.locationInputRow}>
          <TextInput
            style={styles.locationInput}
            value={locationInput}
            onChangeText={setLocationInput}
            placeholder="e.g. Times Square, NYC"
            placeholderTextColor={Colors.textTertiary}
            returnKeyType="done"
            onSubmitEditing={() => {
              if (locationInput.trim()) {
                onSetManualLocation(locationInput.trim());
                setLocationInput('');
              }
            }}
          />
          <TouchableOpacity
            style={[styles.locationSetBtn, !locationInput.trim() && styles.locationSetBtnDisabled]}
            onPress={() => {
              if (locationInput.trim()) {
                onSetManualLocation(locationInput.trim());
                setLocationInput('');
              }
            }}
            disabled={!locationInput.trim()}
          >
            <Text style={styles.locationSetBtnText}>Set</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={onRefresh}>
          <Text style={[styles.bannerErrorText, { marginTop: 4, textDecorationLine: 'underline' }]}>
            Retry GPS
          </Text>
        </TouchableOpacity>
      </View>
    );
  }
  return null;
}

function AnimatedChatBubble({ message }: { message: Message }) {
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
        <View style={styles.guideAvatar}>
          <Text style={styles.guideAvatarText}>🧭</Text>
        </View>
      )}
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
    </Animated.View>
  );
}

export default function ChatScreen(_props: Props) {
  const { gps, status, errorMessage, refresh, manualLocation, setManualLocation } = useLocation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [inferring, setInferring] = useState(false);
  const [speakResponses, setSpeakResponses] = useState(true);
  const listRef = useRef<FlatList<Message>>(null);
  const speakResponsesRef = useRef(speakResponses);
  const streamRef = useRef<StreamHandle | null>(null);

  useEffect(() => {
    speakResponsesRef.current = speakResponses;
  }, [speakResponses]);

  const scrollToEnd = useCallback(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  // Start a streaming generation for `intent` (text or image), append tokens to a new guide
  // message as they arrive, and pipe completed sentences to TTS so speech runs alongside text.
  const streamGuideResponse = useCallback(
    async (
      intent: 'text' | 'image',
      query: string,
      effectiveLocation: GPSContext | string,
      imageUri?: string
    ) => {
      const guideId = `${Date.now()}-g`;
      const guidePlaceholder: Message = {
        id: guideId,
        role: 'guide',
        text: '',
        locationUsed: effectiveLocation,
      };
      setMessages((prev) => [...prev, guidePlaceholder]);

      const appendDelta = (delta: string) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === guideId ? { ...m, text: m.text + delta } : m))
        );
        scrollToEnd();
      };

      const chunker = new SpeechChunker((segment) => {
        if (speakResponsesRef.current) {
          speechService.enqueue(segment);
        }
      });

      const start = Date.now();

      return new Promise<void>((resolve) => {
        const launch = async () => {
          try {
            const callbacks = {
              onToken: (delta: string) => {
                appendDelta(delta);
                chunker.push(delta);
              },
              onDone: () => {
                chunker.flush();
                const durationMs = Date.now() - start;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === guideId ? { ...m, text: m.text.trim(), durationMs } : m
                  )
                );
                streamRef.current = null;
                setInferring(false);
                scrollToEnd();
                resolve();
              },
              onError: (message: string) => {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === guideId
                      ? { ...m, text: m.text || `Sorry, something went wrong. (${message})` }
                      : m
                  )
                );
                streamRef.current = null;
                setInferring(false);
                scrollToEnd();
                resolve();
              },
            };
            const handle =
              intent === 'image' && imageUri
                ? await localGuideService.askWithImageStream(
                    query,
                    effectiveLocation,
                    imageUri,
                    callbacks
                  )
                : await localGuideService.askStream(query, effectiveLocation, callbacks);
            streamRef.current = handle;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === guideId ? { ...m, text: `Sorry, something went wrong. (${message})` } : m
              )
            );
            streamRef.current = null;
            setInferring(false);
            resolve();
          }
        };
        launch();
      });
    },
    [scrollToEnd]
  );

  useEffect(() => {
    return () => {
      streamRef.current?.abort();
      speechService.stop();
    };
  }, []);

  const addGuideMessage = useCallback((text: string, locationUsed: GPSContext | string, durationMs?: number) => {
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
      const effectiveLocation: GPSContext | string | null =
        (gps ?? autoGuide.latestGps) ?? manualLocation ?? null;
      if (!effectiveLocation) return;

      const userMsg: Message = { id: String(Date.now()), role: 'user', text: transcript };
      setMessages((prev) => [...prev, userMsg]);
      setInferring(true);
      await streamGuideResponse('text', transcript, effectiveLocation);
    },
    [gps, autoGuide.latestGps, manualLocation, streamGuideResponse]
  );

  const voice = useVoiceInput(handleVoiceResult);

  const stopStream = useCallback(() => {
    streamRef.current?.abort();
    streamRef.current = null;
    speechService.stop();
    setInferring(false);
  }, []);

  const sendMessage = useCallback(async () => {
    const query = input.trim();
    if (!query || inferring) return;
    const effectiveLocation: GPSContext | string | null =
      (gps ?? autoGuide.latestGps) ?? manualLocation ?? null;
    if (!effectiveLocation) {
      setMessages((prev) => [
        ...prev,
        { id: String(Date.now()) + '-err', role: 'guide', text: 'Location not available yet. Please wait or enter a location above.' },
      ]);
      return;
    }

    const userMsg: Message = { id: String(Date.now()), role: 'user', text: query };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setInferring(true);
    await streamGuideResponse('text', query, effectiveLocation);
  }, [input, inferring, gps, autoGuide.latestGps, manualLocation, streamGuideResponse]);

  const takePicture = useCallback(async () => {
    if (inferring) return;
    const effectiveLocation: GPSContext | string | null =
      (gps ?? autoGuide.latestGps) ?? manualLocation ?? null;
    if (!effectiveLocation) {
      Alert.alert('No Location', 'Location not available yet. Please enter a location above.');
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
    await streamGuideResponse('image', userQuery, effectiveLocation, imageUri);
  }, [inferring, gps, autoGuide.latestGps, manualLocation, input, streamGuideResponse, scrollToEnd]);

  const renderItem: ListRenderItem<Message> = useCallback(
    ({ item }) => <AnimatedChatBubble message={item} />,
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
        manualLocation={manualLocation}
        onSetManualLocation={setManualLocation}
      />

      <View style={styles.controlsRow}>
        <View style={styles.controlItem}>
          <Text style={styles.controlLabel}>Auto-Guide</Text>
          <Switch
            value={autoGuide.enabled}
            onValueChange={autoGuide.toggle}
            trackColor={{ false: Colors.border, true: Colors.secondary }}
            thumbColor={Colors.surface}
          />
        </View>
        <View style={styles.controlItem}>
          <Text style={styles.controlLabel}>Speak</Text>
          <Switch
            value={speakResponses}
            onValueChange={setSpeakResponses}
            trackColor={{ false: Colors.border, true: Colors.primary }}
            thumbColor={Colors.surface}
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
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyEmoji}>🧭</Text>
            <Text style={styles.emptyHint}>
              {autoGuide.enabled
                ? 'Auto-guide active. Walk around and your guide will speak when something interesting is nearby.'
                : "Ask your local guide anything about what's around you, tap 📷 to take a photo, or enable Auto-Guide."}
            </Text>
          </View>
        }
      />

      {inferring && (messages[messages.length - 1]?.role !== 'guide' || !messages[messages.length - 1]?.text) && (
        <View style={styles.typingRow}>
          <View style={styles.typingBubble}>
            <ActivityIndicator size="small" color={Colors.secondary} />
            <Text style={styles.typingText}>Guide is thinking…</Text>
          </View>
        </View>
      )}

      <View style={styles.inputRow}>
        <TouchableOpacity
          style={[styles.iconBtn, voice.isListening && styles.micBtnActive]}
          onPress={voice.isListening ? voice.stopListening : voice.startListening}
          disabled={inferring}
        >
          <Text style={styles.iconBtnText}>{voice.isListening ? '⏹' : '🎤'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.iconBtn}
          onPress={takePicture}
          disabled={inferring}
        >
          <Text style={styles.iconBtnText}>📷</Text>
        </TouchableOpacity>

        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={voice.isListening ? 'Listening…' : 'Ask about nearby places…'}
          placeholderTextColor={Colors.textTertiary}
          returnKeyType="send"
          onSubmitEditing={sendMessage}
          editable={!inferring && !voice.isListening}
          multiline={false}
        />
        {inferring ? (
          <TouchableOpacity
            style={[styles.sendBtn, styles.stopBtn]}
            onPress={stopStream}
            accessibilityLabel="Stop generating"
          >
            <Text style={styles.sendBtnText}>■</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.sendBtn, !input.trim() && styles.sendBtnDisabled]}
            onPress={sendMessage}
            disabled={!input.trim()}
            accessibilityLabel="Send"
          >
            <Text style={styles.sendBtnText}>↑</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  bannerReady: {
    backgroundColor: Colors.successLight,
    paddingVertical: 7,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#BBF7D0',
  },
  bannerReadyText: { fontSize: 12, color: Colors.success, fontWeight: '500' },
  bannerLoading: {
    backgroundColor: Colors.warningLight,
    paddingVertical: 7,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#FDE68A',
  },
  bannerLoadingText: { fontSize: 12, color: Colors.warning, fontWeight: '500' },
  bannerError: {
    backgroundColor: Colors.errorLight,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#FECACA',
  },
  bannerErrorFallback: {
    backgroundColor: Colors.errorLight,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#FECACA',
  },
  bannerManual: {
    backgroundColor: '#FFF8E1',
    paddingVertical: 7,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#FDE68A',
  },
  bannerManualText: { fontSize: 12, color: '#92400E', fontWeight: '500' },
  locationInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  locationInput: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 13,
    color: Colors.textPrimary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    marginRight: 6,
  },
  locationSetBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  locationSetBtnDisabled: { backgroundColor: Colors.disabled },
  locationSetBtnText: { color: Colors.surface, fontWeight: '600', fontSize: 13 },
  bannerErrorText: { fontSize: 12, color: Colors.error, fontWeight: '500' },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: Colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  controlItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 18,
  },
  controlLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginRight: 7,
    fontWeight: '500',
  },
  stopSpeakBtn: {
    backgroundColor: Colors.error,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  stopSpeakText: { color: Colors.surface, fontSize: 12, fontWeight: '600' },
  messageList: { padding: 16, paddingBottom: 8 },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 80,
    paddingHorizontal: 32,
  },
  emptyEmoji: { fontSize: 48, marginBottom: 16 },
  emptyHint: {
    textAlign: 'center',
    color: Colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
  },
  bubbleRow: { marginVertical: 5, flexDirection: 'row', alignItems: 'flex-end' },
  bubbleRowUser: { justifyContent: 'flex-end' },
  bubbleRowGuide: { justifyContent: 'flex-start' },
  guideAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.secondaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    borderWidth: 1,
    borderColor: Colors.guideBubbleBorder,
  },
  guideAvatarText: { fontSize: 16 },
  bubble: {
    maxWidth: '78%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: {
    backgroundColor: Colors.userBubble,
    borderBottomRightRadius: 4,
    shadowColor: Colors.primary,
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  bubbleGuide: {
    backgroundColor: Colors.guideBubble,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: Colors.guideBubbleBorder,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  bubbleImage: {
    width: 200,
    height: 150,
    borderRadius: 12,
    marginBottom: 8,
  },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTextUser: { color: Colors.userBubbleText },
  bubbleTextGuide: { color: Colors.guideBubbleText },
  bubbleMeta: { fontSize: 10, color: Colors.textTertiary, marginTop: 4, opacity: 0.8 },
  typingRow: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    alignItems: 'flex-start',
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.guideBubble,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.guideBubbleBorder,
  },
  typingText: { marginLeft: 8, fontSize: 13, color: Colors.secondary, fontWeight: '500' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: Colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.micInactive,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  micBtnActive: {
    backgroundColor: Colors.micActive,
  },
  iconBtnText: { fontSize: 18 },
  input: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.textPrimary,
    marginRight: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  sendBtnDisabled: {
    backgroundColor: Colors.disabled,
    shadowOpacity: 0,
    elevation: 0,
  },
  stopBtn: {
    backgroundColor: Colors.error ?? '#d33',
    shadowColor: Colors.error ?? '#d33',
  },
  sendBtnText: { color: Colors.surface, fontWeight: '700', fontSize: 20, lineHeight: 24 },
});
