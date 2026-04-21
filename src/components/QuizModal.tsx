import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
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
  type QuizTask,
} from '../services/LocalGuideService';
import type { Poi } from '../services/PoiService';

interface Props {
  visible: boolean;
  onClose: () => void;
  nearbyPois: Poi[];
}

export function QuizModal({ visible, onClose, nearbyPois }: Props) {
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<QuizTask | null>(null);

  const start = () => {
    if (activeTask) activeTask.abort();
    setQuestions([]);
    setCurrentIdx(0);
    setSelectedIdx(null);
    setScore(0);
    setError(null);
    setLoading(true);
    const titles = nearbyPois.map((p) => p.title).slice(0, 8);
    const task = localGuideService.generateQuiz(titles, 5);
    setActiveTask(task);
    task.promise
      .then((qs) => {
        if (qs.length === 0) {
          setError(t('quiz.empty'));
        } else {
          setQuestions(qs);
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
        setActiveTask(null);
      });
  };

  useEffect(() => {
    if (!visible && activeTask) {
      activeTask.abort();
      setActiveTask(null);
    }
  }, [visible, activeTask]);

  // Reset visual state every open.
  useEffect(() => {
    if (visible) {
      setQuestions([]);
      setCurrentIdx(0);
      setSelectedIdx(null);
      setScore(0);
      setError(null);
    }
  }, [visible]);

  const currentQ = questions[currentIdx];
  const answered = selectedIdx != null;
  const finished = questions.length > 0 && currentIdx >= questions.length;

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

          {questions.length === 0 && !loading && !error && (
            <TouchableOpacity style={styles.cta} onPress={start}>
              <Text style={styles.ctaLabel}>{t('quiz.startButton')}</Text>
            </TouchableOpacity>
          )}

          {loading && (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={Colors.secondary} />
              <Text style={styles.loadingText}>{t('quiz.generating')}</Text>
            </View>
          )}

          {error && !loading && <Text style={styles.error}>{error}</Text>}

          {currentQ && !finished && (
            <View style={styles.questionBox}>
              <Text style={styles.questionIndex}>
                {t('quiz.progress', { current: currentIdx + 1, total: questions.length })}
              </Text>
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
                    <Text style={styles.optionLetter}>{String.fromCharCode(65 + i)}</Text>
                    <Text style={styles.optionLabel}>{opt}</Text>
                  </TouchableOpacity>
                );
              })}
              {answered && (
                <TouchableOpacity
                  style={styles.nextBtn}
                  onPress={() => {
                    setCurrentIdx((i) => i + 1);
                    setSelectedIdx(null);
                  }}
                >
                  <Text style={styles.nextLabel}>{t('quiz.nextButton')}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {finished && (
            <View style={styles.scoreBox}>
              <Text style={styles.scoreHeading}>
                {t('quiz.scoreLine', { correct: score, total: questions.length })}
              </Text>
              <TouchableOpacity style={styles.cta} onPress={start}>
                <Text style={styles.ctaLabel}>{t('quiz.startButton')}</Text>
              </TouchableOpacity>
            </View>
          )}
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
  sheet: {
    maxHeight: '85%',
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
  questionIndex: {
    ...Type.metaUpper,
    color: Colors.textTertiary,
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
