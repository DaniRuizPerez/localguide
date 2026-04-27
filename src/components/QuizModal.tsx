import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Colors } from '../theme/colors';
import { Radii, Shadows, Spacing, Type } from '../theme/tokens';
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
}

const TARGET_QUESTIONS = 5;

export function QuizModal({ visible, onClose, nearbyPois }: Props) {
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
      }
    );
  };

  // Abort any in-flight generation when the user dismisses the modal so we
  // don't keep the model busy after the sheet is gone.
  useEffect(() => {
    if (!visible && handleRef.current) {
      handleRef.current.abort();
      handleRef.current = null;
      setGenerating(false);
    }
  }, [visible]);

  // Reset visual state every open.
  useEffect(() => {
    if (visible) {
      setQuestions([]);
      setCurrentIdx(0);
      setSelectedIdx(null);
      setScore(0);
      setError(null);
      setGenerating(false);
    }
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

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.heading}>{t('quiz.title')}</Text>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {questions.length === 0 && !generating && !error && (
              <TouchableOpacity style={styles.cta} onPress={start}>
                <Text style={styles.ctaLabel}>{t('quiz.startButton')}</Text>
              </TouchableOpacity>
            )}

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

                {answered && advanceReady && (
                  <TouchableOpacity
                    style={styles.nextBtn}
                    onPress={() => {
                      setCurrentIdx((i) => i + 1);
                      setSelectedIdx(null);
                    }}
                  >
                    <Text style={styles.nextLabel}>{advanceLabel}</Text>
                  </TouchableOpacity>
                )}

                {waitingForNext && (
                  <View style={styles.waitingRow}>
                    <ActivityIndicator color={Colors.secondary} />
                    <Text style={styles.loadingText}>
                      {t('quiz.preparingNext')}
                    </Text>
                  </View>
                )}
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
                <TouchableOpacity style={styles.cta} onPress={start}>
                  <Text style={styles.ctaLabel}>{t('quiz.startButton')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </Pressable>
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
  // Fixed height so the sheet always pulls up to a comfortable size — it
  // used to use `maxHeight` which collapsed to content height on the start
  // screen and made the sheet "barely visible".
  sheet: {
    height: '85%',
    backgroundColor: Colors.background,
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xxl,
    ...Shadows.softFloating,
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
    marginBottom: Spacing.md,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: Spacing.lg,
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
    gap: 10,
    marginTop: Spacing.md,
    alignSelf: 'flex-end',
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
  nextBtn: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: Radii.md,
    marginTop: Spacing.sm,
    ...Shadows.chipActiveHard,
  },
  nextLabel: {
    ...Type.button,
    color: '#FFFFFF',
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
