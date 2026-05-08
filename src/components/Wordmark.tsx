import React from 'react';
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Colors } from '../theme/colors';
import { Type } from '../theme/tokens';

const CANYON_MARK = require('../../assets/canyon/canyon-header-84.png');

interface Props {
  style?: StyleProp<ViewStyle>;
  size?: number;
  iconOnly?: boolean; // hide text, render glyph only
}

export function Wordmark({ style, size, iconOnly }: Props) {
  const containerStyle: StyleProp<ViewStyle>[] = [styles.row, style];
  if (iconOnly) {
    containerStyle.push(styles.iconOnlyContainer);
  }
  // iconOnly = standalone brand mark in the header (~36 dp); inline = sized to text (size + 2 px).
  const resolvedSize = size ?? (iconOnly ? 36 : 18);
  const glyphSize = iconOnly ? resolvedSize : resolvedSize * 0.9;
  return (
    <View
      style={containerStyle}
      accessibilityLabel={iconOnly ? 'AI Offline Tour Guide' : undefined}
    >
      <Image
        source={CANYON_MARK}
        style={[
          { width: glyphSize, height: glyphSize },
          iconOnly ? undefined : styles.glyphSpacing,
        ]}
        resizeMode="contain"
        testID="wordmark-glyph"
      />
      {!iconOnly && (
        <Text style={[Type.title, { color: Colors.text, fontSize: resolvedSize + 2 }]}>AI Offline Tour Guide</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconOnlyContainer: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
  },
  glyphSpacing: { marginRight: 8 },
});
