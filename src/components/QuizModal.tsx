import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../theme/colors';
import { Radii, Shadows, Sizing, Spacing, Type } from '../theme/tokens';
import { t } from '../i18n';
import {
  localGuideService,
  type QuizQuestion,
  type QuizStreamHandle,
} from '../services/LocalGuideService';
import type { Poi } from '../services/PoiService';

interface Props {
  visible: boolean;
  onClose: () => void;
  nearbyPois: Poi[];
  /**
   * Human-readable place label (e.g. "Palo Alto, California") used to
   * ground the LLM. Without this the model drifts to famous landmarks
   * elsewhere when the POI list is thin or unfamiliar.
   */
  locationLabel?: string | null;
}

const TARGET_QUESTIONS = 5;

export function QuizModal({ visible, onClose, nearbyPois, locationLabel }: Props) {
  // The Modal renders edge-to-edge (under any system gesture nav). Without
  // accounting for the bottom inset, our pinned footer (which holds the
  // primary "Start Quiz" CTA) ends up sitting *behind* the gesture bar on
  // phones that have one — exactly the bug the user reported. Add
  // insets.bottom to the sheet's paddingBottom so the CTA always clears the
  // system UI regardless of device.
  const insets = useSafeAreaInsets();
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  // True while the model is still producing more questions for this run.
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Stored in a ref (not state) so the close-time cleanup effect doesn't see
  // a stale value the way `useState` snapshots would.
  const handleRef = useRef<QuizStreamHandle | null>(null);

  const start = () => {
    handleRef.current?.abort();
    setQuestions([]);
    setCurrentIdx(0);
    setSelectedIdx(null);
    setScore(0);
    setError(null);
    setGenerating(true);

    const titles = nearbyPois.map((p) => p.title).slice(0, 8);
    handleRef.current = localGuideService.generateQuizStream(
      titles,
      TARGET_QUESTIONS,
      {
        onQuestion: (q) => {
          setQuestions((prev) => [...prev, q]);
        },
        onDone: (all) => {
          setGenerating(false);
          handleRef.current = null;
          if (all.length === 0) setError(t('quiz.empty'));
        },
        onError: (msg) => {
          setGenerating(false);
          handleRef.current = null;
          setError(msg);
        },
      },
      locationLabel ?? undefined
    );
  };

  // Persistence: do NOT reset state when the modal closes/opens — the user
  // wants closing the sheet and reopening it to leave the quiz exactly where
  // they were. Resets only happen explicitly via `start()` (new quiz). On
  // unmount we still abort any in-flight generation so we don't leak the
  // model.
  useEffect(
    () => () => {
      handleRef.current?.abort();
      handleRef.current = null;
    },
    []
  );

  // Auto-start generation as soon as the modal opens with a fresh state, so
  // the user doesn't sit through 25 s of Q1 generation after tapping a
  // dedicated "Start Quiz" button. Generation is low-priority, so it yields
  // to nearby-places / guide-facts requests if the user keeps interacting
  // with the home screen behind the sheet. Aborts on close (handled by the
  // unmount effect above and by the `finished` effect below).
  useEffect(() => {
    if (!visible) return;
    if (handleRef.current) return; // already generating
    if (questions.length > 0) return; // already have a quiz in flight or finished
    if (error) return; // don't auto-restart after a failure
    start();
    // start() doesn't depend on any state used elsewhere; rebuilding the
    // closure on every render would re-trigger the effect spuriously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const currentQ = questions[currentIdx];
  const answered = selectedIdx != null;
  const reachedTarget = questions.length >= TARGET_QUESTIONS;
  const onLastEmitted = currentIdx >= questions.length - 1;
  // We can advance whenever there's already a next question loaded, or
  // we've hit the target count, or the model gave up before reaching it.
  const advanceReady =
    answered &&
    (currentIdx + 1 < questions.length ||
      reachedTarget ||
      (!generating && questions.length > 0));
  // Show the "Preparing next…" hint only while we genuinely expect more —
  // not while the model is still wrapping up after Q5.
  const waitingForNext =
    answered && onLastEmitted && generating && !reachedTarget;
  const advanceLabel =
    currentIdx + 1 < questions.length
      ? t('quiz.nextButton')
      : t('quiz.seeResults');
  // Once the user has advanced past the last emitted question, show the
  // score even if the model is still wrapping up — we don't need more
  // questions, and abort the stream so we don't keep the device busy.
  const finished =
    questions.length > 0 &&
    currentIdx >= questions.length &&
    (reachedTarget || !generating);
  const queuedAhead = Math.max(0, questions.length - currentIdx - 1);

  useEffect(() => {
    if (finished && handleRef.current) {
      handleRef.current.abort();
      handleRef.current = null;
      setGenerating(false);
    }
  }, [finished]);

  // Drag-to-dismiss: a downward drag on the handle/header translates the
  // sheet, and on release we either snap back to 0 or animate it offscreen
  // and close. Only attached to the handle area so taps + scrolls in the
  // body still work normally.
  const dragY = useRef(new Animated.Value(0)).current;
  const screenHeight = Dimensions.get('window').height;
  const dragResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
        onPanResponderMove: (_e, g) => {
          if (g.dy > 0) dragY.setValue(g.dy);
        },
        onPanResponderRelease: (_e, g) => {
          const shouldClose = g.dy > 120 || g.vy > 1.2;
          if (shouldClose) {
            Animated.timing(dragY, {
              toValue: screenHeight,
              duration: 180,
              useNativeDriver: true,
            }).start(() => {
              dragY.setValue(0);
              onClose();
            });
          } else {
            Animated.spring(dragY, {
              toValue: 0,
              useNativeDriver: true,
              tension: 80,
              friction: 10,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        },
      }),
    [dragY, onClose, screenHeight]
  );

  // Reset translation when the sheet is reopened so a previous drag-down
  // doesn't leak into the next session.
  useEffect(() => {
    if (visible) dragY.setValue(0);
  }, [visible, dragY]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      hardwareAccelerated
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Animated.View
          style={[
            styles.sheet,
            // Add the system bottom inset on top of our static padding so the
            // pinned footer never disappears under a gesture-nav bar.
            { paddingBottom: Spacing.lg + insets.bottom },
            { transform: [{ translateY: dragY }] },
          ]}
          // Block backdrop press from firing when interacting with the sheet.
          onStartShouldSetResponder={() => true}
        >
          <View style={styles.handleArea} {...dragResponder.panHandlers}>
            <View style={styles.handle} />
            <Text style={styles.heading}>{t('quiz.title')}</Text>
            <Text style={styles.disclaimer}>{t('quiz.aiDisclaimer')}</Text>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {questions.length === 0 && generating && (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={Colors.secondary} />
                <Text style={styles.loadingText}>{t('quiz.generating')}</Text>
              </View>
            )}

            {error && !generating && <Text style={styles.error}>{error}</Text>}

            {currentQ && !finished && (
              <View style={styles.questionBox}>
                <View style={styles.progressRow}>
                  <Text style={styles.questionIndex}>
                    {t('quiz.progress', {
                      current: currentIdx + 1,
                      total: TARGET_QUESTIONS,
                    })}
                  </Text>
                  {generating && queuedAhead > 0 && (
                    <Text style={styles.queueHint}>
                      {t('quiz.moreOnTheWay', { count: queuedAhead })}
                    </Text>
                  )}
                </View>
                <Text style={styles.question}>{currentQ.question}</Text>
                {currentQ.options.map((opt, i) => {
                  const isChosen = selectedIdx === i;
                  const isCorrect = answered && i === currentQ.correctIndex;
                  const isWrongChoice = answered && isChosen && !isCorrect;
                  return (
                    <TouchableOpacity
                      key={i}
                      style={[
                        styles.option,
                        isCorrect && styles.optionCorrect,
                        isWrongChoice && styles.optionWrong,
                      ]}
                      onPress={() => {
                        if (answered) return;
                        setSelectedIdx(i);
                        if (i === currentQ.correctIndex) setScore((s) => s + 1);
                      }}
                      disabled={answered}
                      testID={`quiz-option-${i}`}
                    >
                      <Text style={styles.optionLetter}>
                        {String.fromCharCode(65 + i)}
                      </Text>
                      <Text style={styles.optionLabel}>{opt}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {finished && (
              <View style={styles.scoreBox}>
                <Text style={styles.scoreHeading}>
                  {t('quiz.scoreLine', {
                    correct: score,
                    total: questions.length,
                  })}
                </Text>
              </View>
            )}
          </ScrollView>

          {/*
            Action footer: pinned outside the ScrollView so the primary CTA is
            always reachable even when the question text + options overflow.
            The button shown depends on the current quiz state; only one is
            visible at a time.
          */}
          <View style={styles.footer}>
            {questions.length === 0 && !generating && !error && (
              <TouchableOpacity style={styles.cta} onPress={start}>
                <Text style={styles.ctaLabel}>{t('quiz.startButton')}</Text>
              </TouchableOpacity>
            )}

            {currentQ && !finished && answered && advanceReady && (
              <TouchableOpacity
                style={styles.cta}
                onPress={() => {
                  setCurrentIdx((i) => i + 1);
                  setSelectedIdx(null);
                }}
              >
                <Text style={styles.ctaLabel}>{advanceLabel}</Text>
              </TouchableOpacity>
            )}

            {currentQ && !finished && waitingForNext && (
              <View style={styles.waitingRow}>
                <ActivityIndicator color={Colors.secondary} />
                <Text style={styles.loadingText}>
                  {t('quiz.preparingNext')}
                </Text>
              </View>
            )}

            {finished && (
              <TouchableOpacity style={styles.cta} onPress={start}>
                <Text style={styles.ctaLabel}>{t('quiz.startButton')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  // Percentage-based height so the sheet pulls up to a comfortable size on
  // every device. `maxHeight` collapses to content size and made the sheet
  // "barely visible" on the start screen, so we keep a hard `height` here;
  // the bottom safe-area inset is added inline at render time so the pinned
  // CTA never disappears under gesture-nav bars (the original bug).
  sheet: {
    height: '85%',
    // Belt-and-braces: cap the sheet to 85vh so on very tall phones / split
    // screens we don't grow taller than the available viewport.
    maxHeight: Sizing.vh(90),
    backgroundColor: Colors.background,
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    // paddingBottom is applied inline so we can add insets.bottom dynamically.
    ...Shadows.softFloating,
  },
  // The header strip captures the drag gesture; making it tall enough to be
  // an easy grab target on touch.
  handleArea: {
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.xs,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  heading: {
    ...Type.h1,
    color: Colors.text,
    marginBottom: 4,
  },
  // AI-generated content warning shown directly below the title. Kept small
  // and tertiary-colored so it doesn't compete with the question itself,
  // but visible from the moment the sheet opens so the user sees it before
  // they start grading their score against the model.
  disclaimer: {
    ...Type.bodySm,
    color: Colors.textTertiary,
    marginBottom: Spacing.md,
    fontStyle: 'italic',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: Spacing.md,
  },
  // Pinned at the bottom of the sheet so the action button is always
  // reachable even when a long question + 4 options overflow the body.
  footer: {
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    marginTop: Spacing.sm,
  },
  cta: {
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    borderRadius: Radii.md,
    alignItems: 'center',
    ...Shadows.ctaHard,
  },
  ctaLabel: {
    ...Type.button,
    color: '#FFFFFF',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  waitingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  loadingText: {
    ...Type.bodySm,
    color: Colors.textSecondary,
  },
  error: {
    ...Type.bodySm,
    color: Colors.error,
    marginBottom: Spacing.md,
  },
  questionBox: {
    marginTop: Spacing.sm,
    gap: 10,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  questionIndex: {
    ...Type.metaUpper,
    color: Colors.textTertiary,
  },
  queueHint: {
    ...Type.metaUpper,
    color: Colors.secondary,
  },
  question: {
    ...Type.title,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: Radii.md,
  },
  optionCorrect: {
    backgroundColor: Colors.successLight,
    borderColor: Colors.success,
  },
  optionWrong: {
    backgroundColor: Colors.errorLight,
    borderColor: Colors.error,
  },
  optionLetter: {
    ...Type.button,
    color: Colors.primary,
    width: 22,
  },
  optionLabel: {
    ...Type.body,
    color: Colors.text,
    flex: 1,
  },
  scoreBox: {
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.lg,
  },
  scoreHeading: {
    ...Type.h1,
    color: Colors.text,
  },
});
