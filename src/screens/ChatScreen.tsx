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
import { useFeatureTier } from '../hooks/useFeatureTier';
import { type GuideTopic } from '../services/LocalGuideService';
import { speechService } from '../services/SpeechService';
import { guidePrefs } from '../services/GuidePrefs';
import type { GPSContext } from '../services/InferenceService';
import type { Poi } from '../services/PoiService';
import type { Message } from '../types/chat';
import { TopicChips } from '../components/TopicChips';
import { DwellBanner } from '../components/DwellBanner';
import { Colors } from '../theme/colors';
import { Radii, Type } from '../theme/tokens';
import { VoiceRateControls } from '../components/VoiceRateControls';
import { PlaybackControls } from '../components/PlaybackControls';
import { ItineraryModal } from '../components/ItineraryModal';
import { QuizModal } from '../components/QuizModal';
import { ChatHeader } from '../components/ChatHeader';
import { MessageList } from '../components/MessageList';
import { ManualLocationRow } from '../components/ManualLocationRow';
import { ChatInputBar } from '../components/ChatInputBar';
import { TypingIndicator } from '../components/ChatBubble';
import { HomeState } from '../components/HomeState';
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [itineraryOpen, setItineraryOpen] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const { features } = useFeatureTier();
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

  const { pois } = useNearbyPois(gps, poiRadiusMeters, { hiddenGems });

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

  const sendText = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) return;
      if (!effectiveLocation) {
        messages.addGuideMessage(
          'Location not available yet. Please wait or enter a location above.',
          ''
        );
        return;
      }
      messages.addUserMessage(trimmed);
      await stream({ intent: 'text', query: trimmed, location: effectiveLocation });
    },
    [effectiveLocation, messages, stream]
  );

  const handleVoiceResult = useCallback((transcript: string) => sendText(transcript), [sendText]);
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

  const sendFromInput = useCallback(async () => {
    if (inferring) return;
    const query = input;
    setInput('');
    await sendText(query);
  }, [input, inferring, sendText]);

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
  const hasMessages = messages.messages.length > 0;

  // Coalesce slow-device + hallucination warnings into one dismissible
  // notice shown once, above the input. Priority: slow-device first (it's
  // tier-specific), else hallucination.
  const noticeText =
    features?.slowInference === true
      ? t('chat.slowDevice')
      : !hasMessages
        ? null // skip the generic hallucination warning on the Home state to keep it clean
        : t('app.hallucinationWarning');

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
        onSettingsPress={() => setSettingsOpen(true)}
      />

      {(status === 'denied' || status === 'error') && !gps && (
        <ManualLocationRow
          onRefresh={refresh}
          onSetManualLocation={setManualLocation}
          manualLocation={manualLocation}
        />
      )}

      {hasMessages ? (
        <>
          {/* One contextual strip — topic filter. Radius, length, voice hide in ⚙. */}
          <TopicChips selected={topic} onSelect={setTopic} />

          <MessageList
            ref={listRef}
            messages={messages.messages}
            autoGuideEnabled={autoGuide.enabled}
          />

          {showTyping && <TypingIndicator />}

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

          {noticeText && !noticeDismissed && (
            <NoticeCard text={noticeText} onDismiss={() => setNoticeDismissed(true)} />
          )}

          <PlaybackControls />
        </>
      ) : (
        <HomeState
          placeName={gps?.placeName ?? manualLocation}
          radiusMeters={poiRadiusMeters}
          pois={pois}
          onPlanDay={() => setItineraryOpen(true)}
          onQuiz={() => setQuizOpen(true)}
          onAsk={(q) => sendText(q)}
          onNarratePoi={narratePoi}
          onChangeRadius={() => setSettingsOpen(true)}
          disabled={inferring}
        />
      )}

      <ChatInputBar
        input={input}
        onChangeInput={setInput}
        onSend={sendFromInput}
        onStop={stop}
        onCameraPress={takePicture}
        onMicToggle={voice.isListening ? voice.stopListening : voice.startListening}
        inferring={inferring}
        isListening={voice.isListening}
      />

      <VoiceRateControls
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        autoGuide={autoGuide.enabled}
        onAutoGuideChange={autoGuide.toggle}
        speak={speakResponses}
        onSpeakChange={(next) => {
          setSpeakResponses(next);
          if (!next) speechService.stop();
        }}
        hiddenGems={hiddenGems}
        onHiddenGemsChange={(next) => guidePrefs.setHiddenGems(next)}
        radiusMeters={poiRadiusMeters}
        onRadiusChange={setPoiRadiusMeters}
      />
      <ItineraryModal
        visible={itineraryOpen}
        onClose={() => setItineraryOpen(false)}
        location={effectiveLocation}
        nearbyPois={pois}
      />
      <QuizModal visible={quizOpen} onClose={() => setQuizOpen(false)} nearbyPois={pois} />
    </KeyboardAvoidingView>
  );
}

function NoticeCard({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <View style={styles.notice}>
      <Text style={styles.noticeGlyph}>ⓘ</Text>
      <Text style={styles.noticeText} numberOfLines={2}>
        {text}
      </Text>
      <TouchableOpacity onPress={onDismiss} style={styles.noticeDismiss} accessibilityLabel={t('chat.gotIt')}>
        <Text style={styles.noticeDismissGlyph}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  errorBanner: {
    backgroundColor: Colors.errorLight,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(198,70,70,0.25)',
  },
  notice: {
    marginHorizontal: 14,
    marginTop: 4,
    marginBottom: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: Radii.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(251,235,208,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(244,194,122,0.5)',
  },
  noticeGlyph: {
    fontSize: 12,
    color: '#8A4B00',
  },
  noticeText: {
    flex: 1,
    ...Type.hint,
    color: '#8A4B00',
    lineHeight: 14,
  },
  noticeDismiss: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noticeDismissGlyph: {
    ...Type.chip,
    color: '#8A4B00',
    opacity: 0.7,
  },
});

