import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  ActivityIndicator,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { PillowChip } from './PillowChip';
import { Colors } from '../theme/colors';
import type { Poi } from '../services/PoiService';

export function AttractionsChips({
  pois,
  loading,
  onSelect,
  disabled,
  style,
}: {
  pois: Poi[];
  loading: boolean;
  onSelect: (poi: Poi) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  if (!loading && pois.length === 0) {
    return null;
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.scroll, style]}
      contentContainerStyle={styles.row}
    >
      {loading && pois.length === 0 && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={Colors.secondary} />
          <Text style={styles.loadingText}>Finding places nearby…</Text>
        </View>
      )}
      {pois.map((p) => {
        const isLlm = p.source === 'llm';
        return (
          <PillowChip
            key={`${p.source}-${p.pageId}`}
            label={p.title}
            icon={isLlm ? '🧠' : '📍'}
            meta={!isLlm ? formatDistance(p.distanceMeters) : undefined}
            variant="sage"
            onPress={() => onSelect(p)}
            disabled={disabled}
            accessibilityLabel={
              isLlm ? `Narrate about ${p.title} (AI suggested)` : `Narrate about ${p.title}`
            }
          />
        );
      })}
    </ScrollView>
  );
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 0,
    backgroundColor: Colors.background,
  },
  row: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    gap: 8,
  },
  loadingText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
});
