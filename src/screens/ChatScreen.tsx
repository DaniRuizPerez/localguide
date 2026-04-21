import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { RootTabParamList } from '../navigation/AppNavigator';
import { useLocation } from '../hooks/useLocation';
import { useAutoGuide } from '../hooks/useAutoGuide';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { useChatMessages } from '../hooks/useChatMessages';
import { useGuideStream } from '../hooks/useGuideStream';
import { useNearbyPois } from '../hooks/useNearbyPois';
import { useProximityNarration } from '../hooks/useProximityNarration';
import { useDwellDetection } from '../hooks/useDwellDetection';
import { localGuideService, type GuideTopic } from '../services/LocalGuideService';
import { speechService } from '../services/SpeechService';
import { guidePrefs } from '../services/GuidePrefs';
import { inferenceService, type GPSContext } from '../services/InferenceService';
import type { Poi } from '../services/PoiService';
import type { Message } from '../types/chat';
import { TopicChips } from '../components/TopicChips';
import { AttractionsChips } from '../components/AttractionsChips';
import { RadiusSelector } from '../components/RadiusSelector';
import { DwellBanner } from '../components/DwellBanner';
import { Colors } from '../theme/colors';
import { Type } from '../theme/tokens';
import { NarrationLengthPicker } from '../components/NarrationLengthPicker';
import { VoiceRateControls } from '../components/VoiceRateControls';
import { PlaybackControls } from '../components/PlaybackControls';
import { ItineraryModal } from '../components/ItineraryModal';
import { QuizModal } from '../components/QuizModal';
import { ChatHeader } from '../components/ChatHeader';
import { MessageList } from '../components/MessageList';
import { ManualLocationRow } from '../components/ManualLocationRow';
import { ChatInputBar } from '../components/ChatInputBar';
import { ChatControlsRow } from '../components/ChatControlsRow';
import { TypingIndicator } from '../components/ChatBubble';
import { t } from '../i18n';

type Props = BottomTabScreenProps<RootTabParamList, 'Chat'>;

const AUTO_GUIDE_WELCOME_CUE =
  'Welcome the visitor to this area and give a brief overview of its character and what makes it worth exploring.';

export default function ChatScreen(props: Props) {
  const { gps, status, refresh, manualLocation, setManualLocation } = useLocation();

  const [input, setInput] = useState('');
  const [topic, setTopic] = useState<GuideTopic>(props.route.params?.initialTopic ?? 'everything');
  const [speakResponses, setSpeakResponses] = useState(true);
  const [poiRadiusMeters, setPoiRadiusMeters] = useState(1000);
  const [narrationSettingsOpen, setNarrationSettingsOpen] = useState(false);
  const [itineraryOpen, setItineraryOpen] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [slowDeviceDismissed, setSlowDeviceDismissed] = useState(false);
  const [hallucinationDismissed, setHallucinationDismissed] = useState(false);
  const [deviceTier, setDeviceTier] = useState<'low' | 'mid' | 'high' | null>(null);
  const [hiddenGems, setHiddenGems] = useState<boolean>(guidePrefs.get().hiddenGems);
  const [dismissedDwellIds, setDismissedDwellIds] = useState<Set<number>>(new Set());

  useEffect(
    () => guidePrefs.subscribe((p) => setHiddenGems(p.hiddenGems)),
    []
  );

  const topicRef = useRef<GuideTopic>(topic);
  useEffect(() => {
    topicRef.current = topic;
  }, [topic]);

  const speakRef = useRef(speakResponses);
  useEffect(() => {
    speakRef.current = speakResponses;
  }, [speakResponses]);

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
  const scrollToEnd = useCallback(
    () => setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100),
    []
  );

  const messages = useChatMessages();
  const { inferring, stream, stop } = useGuideStream({
    messages,
    speakResponsesRef: speakRef,
    topicRef,
    onScroll: scrollToEnd,
  });

  const { pois, loading: poisLoading } = useNearbyPois(gps, poiRadiusMeters, { hiddenGems });

  const autoGuide = useAutoGuide((text, autoGps) => {
    messages.addGuideMessage(text, autoGps);
    scrollToEnd();
  });

  const effectiveLocation = (gps ?? autoGuide.latestGps) ?? manualLocation ?? null;

  const narratePoi = useCallback(
    async (poi: Poi) => {
      if (!effectiveLocation) return;
      if (inferring) {
        stop();
      }
      const cue = `Tell me about ${poi.title}.`;
      messages.addUserMessage(cue);
      await stream({ intent: 'text', query: cue, location: effectiveLocation });
    },
    [effectiveLocation, inferring, stop, messages, stream]
  );

  const handleVoiceResult = useCallback(
    async (transcript: string) => {
      if (!effectiveLocation) return;
      messages.addUserMessage(transcript);
      await stream({ intent: 'text', query: transcript, location: effectiveLocation });
    },
    [effectiveLocation, messages, stream]
  );

  const voice = useVoiceInput(handleVoiceResult);

  // Proximity narration (walking past a POI) — only while Auto-Guide is on.
  useProximityNarration({
    gps,
    pois,
    onNarrate: narratePoi,
    enabled: autoGuide.enabled && !inferring,
  });

  // Dwell (prolonged presence at a POI) — runs independent of Auto-Guide.
  const dwellCandidate = useDwellDetection({ gps, pois, enabled: !inferring });
  const visibleDwell =
    dwellCandidate && !dismissedDwellIds.has(dwellCandidate.poi.pageId) ? dwellCandidate : null;

  // One-shot welcome narration when Auto-Guide toggles on and we have GPS.
  const welcomedRef = useRef(false);
  useEffect(() => {
    if (!autoGuide.enabled) {
      welcomedRef.current = false;
      return;
    }
    if (welcomedRef.current || !gps || inferring) return;
    welcomedRef.current = true;
    messages.addUserMessage('Auto-Guide: introduce this area');
    stream({ intent: 'text', query: AUTO_GUIDE_WELCOME_CUE, location: gps });
  }, [autoGuide.enabled, gps, inferring, messages, stream]);

  const sendMessage = useCallback(async () => {
    const query = input.trim();
    if (!query || inferring) return;
    if (!effectiveLocation) {
      messages.addGuideMessage('Location not available yet. Please wait or enter a location above.', '');
      return;
    }
    messages.addUserMessage(query);
    setInput('');
    await stream({ intent: 'text', query, location: effectiveLocation });
  }, [input, inferring, effectiveLocation, messages, stream]);

  const takePicture = useCallback(async () => {
    if (inferring) return;
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
    messages.addUserMessage(userQuery || 'What do you see here?', imageUri);
    setInput('');
    scrollToEnd();
    await stream({ intent: 'image', query: userQuery, location: effectiveLocation, imageUri });
  }, [inferring, effectiveLocation, input, messages, stream, scrollToEnd]);

  const dismissDwell = useCallback((pageId: number) => {
    setDismissedDwellIds((prev) => {
      const next = new Set(prev);
      next.add(pageId);
      return next;
    });
  }, []);

  const lastMsg = messages.messages[messages.messages.length - 1];
  const showTyping = inferring && (lastMsg?.role !== 'guide' || !lastMsg.text);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={88}
    >
      <ChatHeader
        status={status}
        gps={gps}
        manualLocation={manualLocation}
        busy={inferring}
        onIdentifyPress={takePicture}
        onSettingsPress={() => setNarrationSettingsOpen(true)}
      />

      {(status === 'denied' || status === 'error') && !gps && (
        <ManualLocationRow
          onRefresh={refresh}
          onSetManualLocation={setManualLocation}
          manualLocation={manualLocation}
        />
      )}

      {deviceTier === 'low' && !slowDeviceDismissed && (
        <DismissBanner text={t('chat.slowDevice')} onDismiss={() => setSlowDeviceDismissed(true)} />
      )}

      {!hallucinationDismissed && (
        <DismissBanner
          text={t('app.hallucinationWarning')}
          onDismiss={() => setHallucinationDismissed(true)}
        />
      )}

      <TopicChips selected={topic} onSelect={setTopic} />
      <NarrationLengthPicker />

      <View style={styles.itineraryCtaRow}>
        <TouchableOpacity
          style={styles.itineraryCta}
          onPress={() => setItineraryOpen(true)}
          accessibilityLabel={t('itinerary.openButton')}
          testID="plan-day-btn"
        >
          <Text style={styles.itineraryGlyph}>🗺</Text>
          <Text style={styles.itineraryLabel}>{t('itinerary.openButton')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.itineraryCta}
          onPress={() => setQuizOpen(true)}
          accessibilityLabel={t('quiz.openButton')}
          testID="quiz-btn"
        >
          <Text style={styles.itineraryGlyph}>🎯</Text>
          <Text style={styles.itineraryLabel}>{t('quiz.openButton')}</Text>
        </TouchableOpacity>
      </View>

      <RadiusSelector value={poiRadiusMeters} onChange={setPoiRadiusMeters} />

      <VoiceRateControls
        visible={narrationSettingsOpen}
        onClose={() => setNarrationSettingsOpen(false)}
      />
      <ItineraryModal
        visible={itineraryOpen}
        onClose={() => setItineraryOpen(false)}
        location={effectiveLocation}
        nearbyPois={pois}
      />
      <QuizModal visible={quizOpen} onClose={() => setQuizOpen(false)} nearbyPois={pois} />

      <AttractionsChips
        pois={pois.slice(0, 8)}
        loading={poisLoading}
        onSelect={narratePoi}
        disabled={inferring}
      />

      <ChatControlsRow
        autoGuide={autoGuide.enabled}
        onAutoGuideChange={autoGuide.toggle}
        speak={speakResponses}
        onSpeakChange={(next) => {
          setSpeakResponses(next);
          if (!next) speechService.stop();
        }}
        hiddenGems={hiddenGems}
        onHiddenGemsChange={(next) => guidePrefs.setHiddenGems(next)}
      />

      <PlaybackControls />

      {autoGuide.error && (
        <View style={styles.errorBanner}>
          <Text style={[Type.bodySm, { color: Colors.error }]}>{autoGuide.error}</Text>
        </View>
      )}

      {visibleDwell && (
        <DwellBanner
          poi={visibleDwell.poi}
          onAccept={() => {
            dismissDwell(visibleDwell.poi.pageId);
            narratePoi(visibleDwell.poi);
          }}
          onDismiss={() => dismissDwell(visibleDwell.poi.pageId)}
        />
      )}

      <MessageList
        ref={listRef}
        messages={messages.messages}
        autoGuideEnabled={autoGuide.enabled}
      />

      {showTyping && <TypingIndicator />}

      <ChatInputBar
        input={input}
        onChangeInput={setInput}
        onSend={sendMessage}
        onStop={stop}
        onCameraPress={takePicture}
        onMicToggle={voice.isListening ? voice.stopListening : voice.startListening}
        inferring={inferring}
        isListening={voice.isListening}
      />
    </KeyboardAvoidingView>
  );
}

function DismissBanner({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <View style={styles.slowDeviceBanner}>
      <Text style={[Type.bodySm, { flex: 1, color: '#8A4B00' }]}>{text}</Text>
      <TouchableOpacity onPress={onDismiss} style={styles.slowDeviceDismiss}>
        <Text style={[Type.chip, { color: '#8A4B00' }]}>{t('chat.gotIt')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
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
    borderRadius: 14,
  },
  errorBanner: {
    backgroundColor: Colors.errorLight,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(198,70,70,0.25)',
  },
  itineraryCtaRow: {
    paddingHorizontal: 14,
    paddingVertical: 4,
    flexDirection: 'row',
    gap: 8,
  },
  itineraryCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: Colors.secondaryLight,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(78,163,116,0.25)',
  },
  itineraryGlyph: {
    fontSize: 14,
  },
  itineraryLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    color: Colors.secondary,
  },
});
