import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Colors } from '../theme/colors';
import { Radii, Shadows, Type } from '../theme/tokens';

interface Props {
  label: string;
  active?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  icon?: string;
  meta?: string;
  variant?: 'default' | 'sage' | 'ghost';
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function PillowChip({
  label,
  active,
  onPress,
  disabled,
  icon,
  meta,
  variant = 'default',
  style,
  accessibilityLabel,
}: Props) {
  const isSage = variant === 'sage';
  const isGhost = variant === 'ghost';

  const bg = active
    ? Colors.primary
    : isSage
    ? 'rgba(109,142,122,0.12)'
    : isGhost
    ? 'transparent'
    : Colors.surface;
  const textColor = active
    ? '#FFFFFF'
    : isSage
    ? Colors.secondary
    : Colors.textSecondary;
  const borderColor = active
    ? Colors.primary
    : isSage
    ? 'rgba(78,163,116,0.25)'
    : Colors.borderLight;

  return (
    <View style={[active && styles.activeWrap, style]}>
      <Pressable
        onPress={onPress}
        disabled={disabled || !onPress}
        style={[
          styles.chip,
          {
            backgroundColor: bg,
            borderColor,
          },
          active && styles.chipActive,
          disabled && styles.disabled,
        ]}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ selected: active }}
      >
        {icon ? <Text style={[styles.icon, { color: textColor }]}>{icon} </Text> : null}
        <Text style={[Type.chip, { color: textColor }]} numberOfLines={1}>
          {label}
        </Text>
        {meta ? (
          <Text style={[styles.meta, { color: active ? 'rgba(255,255,255,0.9)' : Colors.textTertiary }]}>
            {'  '}
            {meta}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  activeWrap: {
    ...Shadows.chipActiveHalo,
    borderRadius: Radii.md,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: 240,
  },
  chipActive: {
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 3,
  },
  icon: {
    fontSize: 11,
    fontWeight: '700',
  },
  meta: {
    fontSize: 10,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.5,
  },
});
