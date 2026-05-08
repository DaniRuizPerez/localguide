import React from 'react';
import Svg, { Circle, Line, Path } from 'react-native-svg';

interface IconProps {
  size?: number;
  color?: string;
}

// Crosshair-with-dot, the Google-Maps "my location" pictogram. Outer ring +
// four cardinal tick marks crossing it + filled centre dot. Universal enough
// that users don't need a label to know it recentres on their position.
// Stroke is deliberately bold (2.4) so the ticks read at 22 px FAB size.
export function MyLocationIcon({ size = 22, color = '#000' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="3.2" fill={color} />
      <Circle cx="12" cy="12" r="7" stroke={color} strokeWidth="2.4" />
      <Line x1="12" y1="0.5" x2="12" y2="4" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
      <Line x1="12" y1="20" x2="12" y2="23.5" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
      <Line x1="0.5" y1="12" x2="4" y2="12" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
      <Line x1="20" y1="12" x2="23.5" y2="12" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
    </Svg>
  );
}

// Trash bin: lid + body + two vertical fill lines. Standard delete affordance,
// used here for "clear breadcrumb trail".
export function TrashIcon({ size = 22, color = '#000' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Lid handle */}
      <Path d="M9 3 H15" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      {/* Lid bar */}
      <Path d="M4 6 H20" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      {/* Bin body */}
      <Path d="M6 6 L7 21 H17 L18 6" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {/* Vertical fill lines */}
      <Line x1="10" y1="11" x2="10" y2="17" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <Line x1="14" y1="11" x2="14" y2="17" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Svg>
  );
}
