import { Animated, StyleSheet, Text } from 'react-native';
import { useEffect, useRef } from 'react';
import { useAppMode } from '../hooks/useAppMode';
import { Colors } from '../theme/colors';
import { t } from '../i18n';

/**
 * Persistent visual signal of offline mode. A 16 px amber bar with an
 * "OFFLINE" label centered, fading in/out over 200 ms when the effective
 * mode flips. Decorative + non-interactive — pointerEvents="none". The
 * label is announced as `accessible={false}` because OfflineNotice's
 * banner already carries an accessibilityRole="alert".
 *
 * Mounted once at root (App.tsx) so it sits above every screen via
 * absolute positioning + zIndex 1000.
 */
export function ModeStripe() {
  const { effective } = useAppMode();
  const opacity = useRef(new Animated.Value(effective === 'offline' ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: effective === 'offline' ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [effective, opacity]);

  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      style={[styles.stripe, { opacity }]}
    >
      <Text style={styles.label} accessible={false}>
        {t('mode.offline').toUpperCase()}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stripe: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 16,
    backgroundColor: Colors.warning,
    zIndex: 1000,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: '#5C3408',
  },
});
