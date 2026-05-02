import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../theme/colors';
import { Radii, Shadows, Spacing, Type } from '../theme/tokens';
import { t, type NoVarKey } from '../i18n';
import { guidePrefs, type ModeChoice } from '../services/GuidePrefs';

interface Props {
  visible: boolean;
  onClose: () => void;
}

interface OptionRow {
  value: ModeChoice;
  labelKey: NoVarKey;
  subKey: NoVarKey;
}

const OPTIONS: OptionRow[] = [
  { value: 'auto',          labelKey: 'mode.optAuto',    subKey: 'mode.optAutoSub'    },
  { value: 'force-online',  labelKey: 'mode.optOnline',  subKey: 'mode.optOnlineSub'  },
  { value: 'force-offline', labelKey: 'mode.optOffline', subKey: 'mode.optOfflineSub' },
];

export function HowShouldIAnswerSheet({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();

  // Mirror the persisted modeChoice into local state so the radio list
  // reflects the live selection even if another surface (Settings) changed it
  // while this sheet was unmounted.
  const [selected, setSelected] = useState<ModeChoice>(() => guidePrefs.get().modeChoice);

  useEffect(() => {
    // Sync on open so we always show the current value.
    if (visible) {
      setSelected(guidePrefs.get().modeChoice);
    }
    return guidePrefs.subscribe((p) => setSelected(p.modeChoice));
  }, [visible]);

  // Drag-to-dismiss: mirrors ItineraryModal's native-driver PanResponder.
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

  // Reset translation when reopened.
  useEffect(() => {
    if (visible) dragY.setValue(0);
  }, [visible, dragY]);

  const handleSelect = (value: ModeChoice) => {
    guidePrefs.setModeChoice(value);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      hardwareAccelerated
    >
      {/*
        Sibling-backdrop layout copied from ItineraryModal: dimmed backdrop
        as a sibling Pressable rather than a wrapper, so the inner Pressables
        get clean native touch handling.
      */}
      <View style={styles.modalRoot}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: Spacing.lg + insets.bottom },
            { transform: [{ translateY: dragY }] },
          ]}
        >
          <View style={styles.handleArea} {...dragResponder.panHandlers}>
            <View style={styles.handle} />
            <Text style={styles.heading}>{t('mode.howShouldIAnswerTitle')}</Text>
            <Text style={styles.sub}>{t('mode.threePlainEnglishChoices')}</Text>
          </View>

          <View style={styles.optionList}>
            {OPTIONS.map((opt) => {
              const isActive = selected === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  testID={`how-answer-opt-${opt.value}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isActive }}
                  style={({ pressed }) => [
                    styles.optionRow,
                    isActive && styles.optionRowActive,
                    pressed && styles.optionRowPressed,
                  ]}
                  onPress={() => handleSelect(opt.value)}
                >
                  <View style={styles.optionBody}>
                    <Text style={[styles.optionLabel, isActive && styles.optionLabelActive]}>
                      {t(opt.labelKey)}
                    </Text>
                    <Text style={styles.optionSub}>{t(opt.subKey)}</Text>
                  </View>
                  {/* Radio indicator */}
                  <View style={[styles.radio, isActive && styles.radioActive]}>
                    {isActive && <View style={styles.radioDot} />}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    ...Shadows.softFloating,
  },
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
  },
  sub: {
    ...Type.bodySm,
    color: Colors.textSecondary,
    marginTop: 4,
    marginBottom: Spacing.md,
  },
  optionList: {
    gap: 10,
    paddingBottom: Spacing.sm,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    padding: 14,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  optionRowActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.background,
  },
  optionRowPressed: {
    opacity: 0.7,
  },
  optionBody: {
    flex: 1,
  },
  optionLabel: {
    ...Type.title,
    color: Colors.text,
  },
  optionLabelActive: {
    color: Colors.primary,
  },
  optionSub: {
    ...Type.bodySm,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
    flexShrink: 0,
  },
  radioActive: {
    borderColor: Colors.primary,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.primary,
  },
});
