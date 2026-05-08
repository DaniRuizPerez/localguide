/**
 * OfflineMapCanvas — compass-style spatial canvas for offline mode.
 *
 * Replaces the blank Google Maps canvas when effective mode is 'offline'.
 * User dot is biased 35% from top so it sits above the bottom-sheet pullup.
 * All POI markers are projected using Mercator lat/lon math (cos(lat) longitude
 * scaling) — correct relative positions but no streets/buildings.
 *
 * SVG layer (react-native-svg):
 *   - Radius circle (filled + stroked)
 *   - Breadcrumb polyline (dashed)
 *   - N/S/E/W cardinal labels
 *
 * Absolute-positioned layers:
 *   - User dot (matches MapScreen's userDotHalo + userDot)
 *   - POI markers (same poiEmojiBubble + poiLabelPill styles as MapScreen)
 */
import React, { type ReactElement } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Circle, Polyline, Text as SvgText } from 'react-native-svg';
import type { GPSContext } from '../services/InferenceService';
import type { Poi } from '../services/PoiService';
import { poiEmojiFor } from '../services/poiTopic';
import { Colors } from '../theme/colors';
import { Shadows } from '../theme/tokens';

// ─── Projection constants ─────────────────────────────────────────────────────

const METERS_PER_DEG_LAT = 111_320;

/**
 * Pure projection function exported for unit testing.
 *
 * @param lat       POI latitude
 * @param lon       POI longitude
 * @param gpsLat    User latitude
 * @param gpsLon    User longitude
 * @param centerX   Canvas x-centre (user dot x)
 * @param centerY   Canvas y-centre (user dot y, biased 35% from top)
 * @param scale     Pixels per metre
 * @returns Screen pixel coordinates for the given lat/lon
 */
export function projectLatLon(
  lat: number,
  lon: number,
  gpsLat: number,
  gpsLon: number,
  centerX: number,
  centerY: number,
  scale: number,
): { x: number; y: number } {
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos((gpsLat * Math.PI) / 180);
  const dE = (lon - gpsLon) * metersPerDegLon;
  const dN = (lat - gpsLat) * METERS_PER_DEG_LAT;
  return { x: centerX + dE * scale, y: centerY - dN * scale };
}

/**
 * Compute the pixels-per-metre scale for a given canvas + radius.
 *
 * halfAxis is the smallest distance from the biased centre to any canvas edge,
 * so the radius circle never clips. 0.9 leaves a small margin.
 */
export function computeScale(
  canvasW: number,
  canvasH: number,
  centerX: number,
  centerY: number,
  radiusMeters: number,
): number {
  const halfAxis = Math.min(centerX, centerY, canvasH - centerY);
  return (halfAxis * 0.9) / radiusMeters;
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface OfflineMapCanvasProps {
  gps: GPSContext;                                              // caller guarantees non-null
  pois: Poi[];                                                  // already filtered by radius
  breadcrumb: { latitude: number; longitude: number }[];
  compassTarget: Poi | null;
  radiusMeters: number;
  onMarkerPress: (p: Poi) => void;
  onPoiAsk: (p: Poi) => void;
}

export function OfflineMapCanvas({
  gps,
  pois,
  breadcrumb,
  compassTarget,
  radiusMeters,
  onMarkerPress,
  onPoiAsk,
}: OfflineMapCanvasProps): ReactElement {
  const { width: canvasW, height: canvasH } = useWindowDimensions();

  const centerX = canvasW / 2;
  const centerY = canvasH * 0.35;

  const scale = computeScale(canvasW, canvasH, centerX, centerY, radiusMeters);
  const radiusPx = radiusMeters * scale;

  // Project a lat/lon to screen coordinates using the current canvas params.
  function project(lat: number, lon: number): { x: number; y: number } {
    return projectLatLon(lat, lon, gps.latitude, gps.longitude, centerX, centerY, scale);
  }

  // Build SVG polyline points string from breadcrumb trail.
  const breadcrumbPoints =
    breadcrumb.length >= 2
      ? breadcrumb
          .map((pt) => {
            const { x, y } = project(pt.latitude, pt.longitude);
            return `${x},${y}`;
          })
          .join(' ')
      : null;

  // Cardinal label positions — at edge midpoints (inside by 16 px).
  const CARDINAL_MARGIN = 20;
  const cardinals = [
    { label: 'N', x: centerX,                        y: CARDINAL_MARGIN },
    { label: 'S', x: centerX,                        y: canvasH - CARDINAL_MARGIN },
    { label: 'E', x: canvasW - CARDINAL_MARGIN - 6,  y: centerY },
    { label: 'W', x: CARDINAL_MARGIN + 6,             y: centerY },
  ];

  return (
    <View style={[styles.canvas, { width: canvasW, height: canvasH }]}>
      {/* ── Static SVG layer ─────────────────────────────────────────── */}
      <Svg width={canvasW} height={canvasH} style={StyleSheet.absoluteFillObject}>
        {/* Radius circle */}
        <Circle
          cx={centerX}
          cy={centerY}
          r={radiusPx}
          fill={Colors.warningLight}
          fillOpacity={0.12}
          stroke={Colors.warning}
          strokeWidth={1}
        />

        {/* Breadcrumb polyline */}
        {breadcrumbPoints !== null && (
          <Polyline
            points={breadcrumbPoints}
            fill="none"
            stroke={Colors.primary}
            strokeWidth={3}
            strokeDasharray="4,4"
          />
        )}

        {/* Cardinal labels */}
        {cardinals.map(({ label, x, y }) => (
          <SvgText
            key={label}
            x={x}
            y={y + 4}
            textAnchor="middle"
            fill={Colors.textTertiary}
            fontSize={10}
            fontWeight="700"
            letterSpacing={1}
          >
            {label}
          </SvgText>
        ))}
      </Svg>

      {/* ── User dot ─────────────────────────────────────────────────── */}
      <View
        style={[
          styles.userDotHalo,
          {
            position: 'absolute',
            left: centerX - 15,
            top: centerY - 15,
          },
        ]}
        pointerEvents="none"
      >
        <View style={styles.userDot} />
      </View>

      {/* ── POI markers ──────────────────────────────────────────────── */}
      {pois.map((p) => {
        const isSelected = compassTarget?.pageId === p.pageId;
        const { x, y } = project(p.latitude, p.longitude);
        // Anchor at bottom-centre of the marker (bubble + pill ≈ 48 px tall,
        // 28 px wide minimum). Shift left by half width, up by full height.
        const markerLeft = x - 14;   // half of minWidth 28
        const markerTop  = y - 48;   // full minHeight
        return (
          <TouchableOpacity
            key={`${p.source}-${p.pageId}`}
            style={[styles.poiMarkerWrap, { position: 'absolute', left: markerLeft, top: markerTop }]}
            onPress={() => onMarkerPress(p)}
            onLongPress={() => onPoiAsk(p)}
            activeOpacity={0.75}
            accessibilityLabel={p.title}
            accessibilityRole="button"
          >
            <View style={[styles.poiEmojiBubble, isSelected && styles.poiEmojiBubbleSelected]}>
              <Text style={styles.poiEmoji}>{poiEmojiFor(p)}</Text>
            </View>
            <View style={[styles.poiLabelPill, isSelected && styles.poiLabelPillSelected]}>
              <Text
                style={[styles.poiLabelText, isSelected && styles.poiLabelTextSelected]}
                numberOfLines={1}
              >
                {p.title}
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
// Marker styles mirror MapScreen exactly — same dimensions, same selection
// convention (border/colour only — NO size change across selected/unselected).

const styles = StyleSheet.create({
  canvas: {
    backgroundColor: Colors.mapBackground,
    overflow: 'hidden',
  },

  // ── User dot ────────────────────────────────────────────────────────────────
  userDotHalo: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(232,132,92,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.primary,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    ...Shadows.pinDrop,
  },

  // ── POI marker — fixed dimensions, no change across selected/unselected ─────
  poiMarkerWrap: {
    alignItems: 'center',
    minWidth: 28,
    minHeight: 48,
  },
  poiEmojiBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Selection: thicker primary-colour border. NO size change.
  poiEmojiBubbleSelected: {
    borderWidth: 2.5,
    borderColor: Colors.primaryDark,
  },
  poiEmoji: {
    fontSize: 14,
  },
  poiLabelPill: {
    marginTop: 2,
    backgroundColor: Colors.surface,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    paddingHorizontal: 4,
    paddingVertical: 1,
    maxWidth: 100,
  },
  // Selection: stronger border + tinted fill. Same dimensions, no layout change.
  poiLabelPillSelected: {
    borderColor: Colors.primary,
    borderWidth: 1.5,
    backgroundColor: Colors.warningLight,
  },
  poiLabelText: {
    fontSize: 11,
    color: Colors.text,
  },
  poiLabelTextSelected: {
    color: Colors.text,
    fontWeight: '700',
  },
});
