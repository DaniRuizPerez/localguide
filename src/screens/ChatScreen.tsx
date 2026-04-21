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
import { localGuideService, type GuideTopic, type ListPlacesTask } from '../services/LocalGuideService';
import { TopicChips } from '../components/TopicChips';
import { AttractionsChips } from '../components/AttractionsChips';
import { RadiusSelector } from '../components/RadiusSelector';
import { speechService } from '../services/SpeechService';
import { SpeechChunker } from '../services/SpeechChunker';
import { inferenceService, type GPSContext, type StreamHandle } from '../services/InferenceService';
import { poiService, type Poi } from '../services/PoiService';
import { useProximityNarration } from '../hooks/useProximityNarration';
import { Colors } from '../theme/colors';
import { Type, Radii, Shadows } from '../theme/tokens';
import { GuideAvatar } from '../components/GuideAvatar';
import { NarrationLengthPicker } from '../components/NarrationLengthPicker';
import { VoiceRateControls } from '../components/VoiceRateControls';
import { t } from '../i18n';

type Props = BottomTabScreenProps<RootTabParamList, 'Chat'>;

interface Message {
  id: string;
  role: 'user' | 'guide';
  text: string;
  imageUri?: string;
  locationUsed?: GPSContext | string;
  durationMs?: number;
}

function LocationPill({
  status,
  gps,
  manualLocation,
}: {
  status: string;
  gps: GPSContext | null;
  manualLocation: string | null;
}) {
  let name = t('chat.locating');
  let dotColor: string = Colors.warning;
  if (status === 'ready' && gps) {
    name = gps.placeName ?? `${gps.latitude.toFixed(3)}, ${gps.longitude.toFixed(3)}`;
    dotColor = Colors.success;
  } else if (manualLocation) {
    name = manualLocation;
    dotColor = Colors.warning;
  } else if (status === 'denied' || status === 'error') {
    name = t('chat.noGps');
    dotColor = Colors.error;
  }
  return (
    <View style={styles.locationPill}>
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text style={[Type.metaUpper, { color: Colors.textSecondary }]} numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}

function ManualLocationRow({
  onRefresh,
  onSetManualLocation,
  manualLocation,
}: {
  onRefresh: () => void;
  onSetManualLocation: (placeName: string) => void;
  manualLocation: string | null;
}) {
  const [locationInput, setLocationInput] = useState('');
  if (manualLocation) return null;
  return (
    <View style={styles.manualRow}>
      <Text style={[Type.bodySm, { color: Colors.error, marginBottom: 6 }]}>
        {t('chat.gpsUnavailable')}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TextInput
          style={styles.manualInput}
          value={locationInput}
          onChangeText={setLocationInput}
          placeholder={t('chat.locationPlaceholder')}
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
          style={[styles.manualSet, !locationInput.trim() && { opacity: 0.5 }]}
          onPress={() => {
            if (locationInput.trim()) {
              onSetManualLocation(locationInput.trim());
              setLocationInput('');
            }
          }}
          disabled={!locationInput.trim()}
        >
          <Text style={[Type.chip, { color: '#FFFFFF' }]}>{t('chat.set')}</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity onPress={onRefresh}>
        <Text style={[Type.bodySm, { color: Colors.error, marginTop: 6, textDecorationLine: 'underline' }]}>
          {t('chat.retryGps')}
        </Text>
      </TouchableOpacity>
    </View>
  );
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
        <View style={styles.avatarWrap}>
          <GuideAvatar size={32} />
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
        <Text style={[isUser ? styles.bubbleTextUser : styles.bubbleTextGuide]}>
          {message.text}
        </Text>
        {message.durationMs != null && (
          <Text style={styles.bubbleMeta}>
            {message.durationMs}MS · {t('chat.onDevice')}
          </Text>
        )}
      </View>
    </Animated.View>
  );
}

function TypingIndicator() {
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
      <View style={[styles.bubble, styles.bubbleGuide, { flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
        <Animated.View style={[styles.typingDot, { opacity: d1 }]} />
        <Animated.View style={[styles.typingDot, { opacity: d2 }]} />
        <Animated.View style={[styles.typingDot, { opacity: d3 }]} />
      </View>
    </View>
  );
}

export default function ChatScreen(props: Props) {
  const { gps, status, errorMessage, refresh, manualLocation, setManualLocation } = useLocation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [inferring, setInferring] = useState(false);
  const [speakResponses, setSpeakResponses] = useState(true);
  const [topic, setTopic] = useState<GuideTopic>(props.route.params?.initialTopic ?? 'everything');
  const topicRef = useRef<GuideTopic>(topic);
  useEffect(() => {
    topicRef.current = topic;
  }, [topic]);

  const [deviceTier, setDeviceTier] = useState<'low' | 'mid' | 'high' | null>(null);
  const [slowDeviceDismissed, setSlowDeviceDismissed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    inferenceService.getDeviceTier().then((info) => {
      if (cancelled || !info) return;
      setDeviceTier(info.tier);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const listRef = useRef<FlatList<Message>>(null);
  const speakResponsesRef = useRef(speakResponses);
  const streamRef = useRef<StreamHandle | null>(null);
  const inferringRef = useRef(inferring);

  const [nearbyPois, setNearbyPois] = useState<Poi[]>([]);
  const [poisLoading, setPoisLoading] = useState(false);
  const [poiRadiusMeters, setPoiRadiusMeters] = useState<number>(1000);
  const [narrationSettingsOpen, setNarrationSettingsOpen] = useState(false);

  useEffect(() => {
    speakResponsesRef.current = speakResponses;
  }, [speakResponses]);

  useEffect(() => {
    inferringRef.current = inferring;
  }, [inferring]);

  const scrollToEnd = useCallback(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

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

      if (llmFallbackTaskRef.current) {
        await llmFallbackTaskRef.current.abort();
        llmFallbackTaskRef.current = null;
      }

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
                    callbacks,
                    topicRef.current
                  )
                : await localGuideService.askStream(
                    query,
                    effectiveLocation,
                    callbacks,
                    topicRef.current
                  );
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
      llmFallbackTaskRef.current?.abort();
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

  const narratePoi = useCallback(
    async (poi: Poi) => {
      const effectiveLocation: GPSContext | string | null =
        (gps ?? autoGuide.latestGps) ?? manualLocation ?? null;
      if (!effectiveLocation) return;
      if (inferringRef.current) {
        streamRef.current?.abort();
        streamRef.current = null;
        speechService.stop();
      }
      const cue = `Tell me about ${poi.title}.`;
      const userMsg: Message = {
        id: `${Date.now()}-poi-${poi.pageId}`,
        role: 'user',
        text: cue,
      };
      setMessages((prev) => [...prev, userMsg]);
      setInferring(true);
      await streamGuideResponse('text', cue, effectiveLocation);
    },
    [gps, autoGuide.latestGps, manualLocation, streamGuideResponse]
  );

  const llmPoiCacheRef = useRef<Map<string, { at: number; pois: Poi[] }>>(new Map());
  const llmFallbackTaskRef = useRef<ListPlacesTask | null>(null);

  useEffect(() => {
    if (!gps) return;
    let cancelled = false;

    const cellKey = `${gps.latitude.toFixed(3)}_${gps.longitude.toFixed(3)}_${poiRadiusMeters}`;
    const LLM_CACHE_TTL = 10 * 60 * 1000;

    const haversine = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 6371000;
      const toRad = (d: number) => (d * Math.PI) / 180;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    };

    setNearbyPois([]);
    setPoisLoading(true);
    poiService
      .fetchNearby(gps.latitude, gps.longitude, poiRadiusMeters)
      .then(async (pois) => {
        if (cancelled) return;
        if (pois.length > 0) {
          const sorted = [...pois]
            .map((p) => ({
              ...p,
              distanceMeters: haversine(gps.latitude, gps.longitude, p.latitude, p.longitude),
            }))
            .filter((p) => p.distanceMeters <= poiRadiusMeters)
            .sort((a, b) => a.distanceMeters - b.distanceMeters);
          if (sorted.length > 0) {
            setNearbyPois(sorted);
            return;
          }
        }

        const cached = llmPoiCacheRef.current.get(cellKey);
        if (cached && Date.now() - cached.at < LLM_CACHE_TTL) {
          setNearbyPois(cached.pois);
          return;
        }
        if (!inferenceService.isLoaded) return;
        if (inferringRef.current) return;
        if (llmFallbackTaskRef.current) {
          await llmFallbackTaskRef.current.abort();
          llmFallbackTaskRef.current = null;
        }
        const task = localGuideService.listNearbyPlaces(gps, poiRadiusMeters);
        llmFallbackTaskRef.current = task;
        try {
          const names = await task.promise;
          if (cancelled) return;
          const llmPois: Poi[] = names.map((name, i) => ({
            pageId: -(Date.now() + i),
            title: name,
            latitude: gps.latitude,
            longitude: gps.longitude,
            distanceMeters: 0,
            source: 'llm' as const,
          }));
          llmPoiCacheRef.current.set(cellKey, { at: Date.now(), pois: llmPois });
          setNearbyPois(llmPois);
        } catch {
          // aborted
        } finally {
          if (llmFallbackTaskRef.current === task) {
            llmFallbackTaskRef.current = null;
          }
        }
      })
      .finally(() => {
        if (!cancelled) setPoisLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gps && gps.latitude.toFixed(3), gps && gps.longitude.toFixed(3), poiRadiusMeters]);

  useProximityNarration({
    gps,
    pois: nearbyPois,
    onNarrate: narratePoi,
    // Proximity-driven narration is the Auto-Guide feature. Speak toggle is
    // orthogonal (controls TTS output only); when Auto-Guide is off we never
    // auto-narrate even if Speak is on, and when it's on we fire narrations
    // even with Speak off (the user still sees them in the chat transcript).
    enabled: autoGuide.enabled && !inferring,
  });

  // Initial area narration when Auto-Guide toggles on. Covers both paths the
  // user cares about: (a) user flips the switch while using the app — narrate
  // immediately for the current location, and (b) the app launches with
  // Auto-Guide already on and GPS arrives a moment later — narrate as soon
  // as we have a fix. Fires exactly once per Auto-Guide session; proximity
  // handles every subsequent trigger as the user walks.
  const autoGuideWelcomedRef = useRef(false);
  useEffect(() => {
    if (!autoGuide.enabled) {
      autoGuideWelcomedRef.current = false;
      return;
    }
    if (autoGuideWelcomedRef.current) return;
    if (!gps) return;
    if (inferringRef.current) return;
    autoGuideWelcomedRef.current = true;
    const cue =
      'Welcome the visitor to this area and give a brief overview of its character and what makes it worth exploring.';
    const userMsg: Message = {
      id: `${Date.now()}-autoguide-welcome`,
      role: 'user',
      text: 'Auto-Guide: introduce this area',
    };
    setMessages((prev) => [...prev, userMsg]);
    setInferring(true);
    streamGuideResponse('text', cue, gps);
  }, [autoGuide.enabled, gps, streamGuideResponse]);

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

  const showTyping =
    inferring &&
    (messages[messages.length - 1]?.role !== 'guide' || !messages[messages.length - 1]?.text);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={88}
    >
      <View style={styles.header}>
        <LocationPill status={status} gps={gps} manualLocation={manualLocation} />
        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={() => setNarrationSettingsOpen(true)}
          accessibilityLabel={t('narration.settingsButton')}
          accessibilityRole="button"
        >
          <Text style={styles.settingsGlyph}>⚙</Text>
        </TouchableOpacity>
      </View>

      {(status === 'denied' || status === 'error') && !gps && (
        <ManualLocationRow
          onRefresh={refresh}
          onSetManualLocation={setManualLocation}
          manualLocation={manualLocation}
        />
      )}

      {deviceTier === 'low' && !slowDeviceDismissed && (
        <View style={styles.slowDeviceBanner}>
          <Text style={[Type.bodySm, { flex: 1, color: '#8A4B00' }]}>
            {t('chat.slowDevice')}
          </Text>
          <TouchableOpacity onPress={() => setSlowDeviceDismissed(true)} style={styles.slowDeviceDismiss}>
            <Text style={[Type.chip, { color: '#8A4B00' }]}>{t('chat.gotIt')}</Text>
          </TouchableOpacity>
        </View>
      )}

      <TopicChips selected={topic} onSelect={setTopic} />

      <NarrationLengthPicker />

      <RadiusSelector value={poiRadiusMeters} onChange={setPoiRadiusMeters} />

      <VoiceRateControls
        visible={narrationSettingsOpen}
        onClose={() => setNarrationSettingsOpen(false)}
      />

      <AttractionsChips
        pois={nearbyPois.slice(0, 8)}
        loading={poisLoading}
        onSelect={narratePoi}
        disabled={inferring}
      />

      <View style={styles.controlsRow}>
        <View style={styles.controlItem}>
          <Text style={styles.controlLabel} numberOfLines={1}>
            {t('chat.autoGuide')}
          </Text>
          <Switch
            value={autoGuide.enabled}
            onValueChange={autoGuide.toggle}
            trackColor={{ false: Colors.border, true: Colors.secondary }}
            thumbColor={Colors.surface}
          />
        </View>
        <View style={styles.controlItem}>
          <Text style={styles.controlLabel} numberOfLines={1}>
            {t('chat.speak')}
          </Text>
          <Switch
            value={speakResponses}
            onValueChange={(next) => {
              setSpeakResponses(next);
              if (!next) speechService.stop();
            }}
            trackColor={{ false: Colors.border, true: Colors.primary }}
            thumbColor={Colors.surface}
          />
        </View>
        {autoGuide.enabled && autoGuide.isSpeaking && (
          <TouchableOpacity style={styles.stopSpeakBtn} onPress={() => speechService.stop()}>
            <Text style={[Type.chip, { color: '#FFFFFF' }]}>{t('chat.stop')}</Text>
          </TouchableOpacity>
        )}
      </View>

      {autoGuide.error && (
        <View style={styles.errorBanner}>
          <Text style={[Type.bodySm, { color: Colors.error }]}>{autoGuide.error}</Text>
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
            <GuideAvatar size={48} />
            <Text style={[Type.title, { color: Colors.text, marginTop: 16, textAlign: 'center' }]}>
              {autoGuide.enabled ? t('chat.autoGuideListening') : t('app.ready')}
            </Text>
            <Text style={[Type.body, { color: Colors.textSecondary, marginTop: 6, textAlign: 'center' }]}>
              {autoGuide.enabled ? t('chat.autoGuideHint') : t('chat.askHint')}
            </Text>
          </View>
        }
      />

      {showTyping && <TypingIndicator />}

      <View style={styles.inputRowWrap}>
        <View style={styles.inputCapsule}>
          <TouchableOpacity
            style={[styles.iconBtn, voice.isListening && styles.micBtnActive]}
            onPress={voice.isListening ? voice.stopListening : voice.startListening}
            disabled={inferring}
          >
            <Text style={styles.iconGlyph}>{voice.isListening ? '⏹' : '🎤'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.iconBtn} onPress={takePicture} disabled={inferring}>
            <Text style={styles.iconGlyph}>📷</Text>
          </TouchableOpacity>

          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={voice.isListening ? t('chat.listening') : t('chat.placeholder')}
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

        {inferring && (
          <ActivityIndicator size="small" color={Colors.secondary} style={{ marginLeft: 8 }} />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  settingsBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.softOutset,
  },
  settingsGlyph: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  locationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: 6,
    ...Shadows.softOutset,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  manualRow: {
    backgroundColor: Colors.errorLight,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(198,70,70,0.25)',
  },
  manualInput: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radii.md,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  manualSet: {
    backgroundColor: Colors.primary,
    borderRadius: Radii.md,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  slowDeviceBanner: {
    backgroundColor: '#FBEBD0',
    borderBottomWidth: 1,
    borderBottomColor: '#F4C27A',
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  slowDeviceDismiss: {
    backgroundColor: '#F4C27A',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radii.md,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: Colors.background,
    gap: 14,
    flexWrap: 'wrap',
  },
  controlItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  controlLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 10,
    letterSpacing: 0.8,
    color: Colors.textSecondary,
    flexShrink: 0,
  },
  stopSpeakBtn: {
    backgroundColor: Colors.error,
    borderRadius: Radii.md,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginLeft: 'auto',
  },
  errorBanner: {
    backgroundColor: Colors.errorLight,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(198,70,70,0.25)',
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
    width: 200,
    height: 150,
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
  bubbleMeta: {
    ...Type.metaUpper,
    color: Colors.textTertiary,
    marginTop: 6,
    opacity: 0.9,
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary,
  },
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
});
