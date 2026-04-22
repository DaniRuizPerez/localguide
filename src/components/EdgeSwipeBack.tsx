import { useRef } from 'react';
import { PanResponder } from 'react-native';

// Left-edge swipe-back gesture. Returns pan handlers the caller spreads
// onto the root View of a screen. The responder only activates when the
// touch (a) starts inside the left edge strip and (b) moves clearly
// rightwards, so taps and vertical scrolls elsewhere are untouched.
export function useEdgeSwipeBack(onBack: () => void) {
  const firedRef = useRef(false);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_evt, g) => isBackSwipe(g),
      onMoveShouldSetPanResponderCapture: (_evt, g) => isBackSwipe(g),
      onPanResponderGrant: () => {
        firedRef.current = false;
      },
      onPanResponderRelease: (_evt, g) => {
        if (!firedRef.current && g.dx > RELEASE_DX) {
          firedRef.current = true;
          onBack();
        }
      },
      onPanResponderTerminate: () => {
        firedRef.current = false;
      },
    })
  ).current;

  return responder.panHandlers;
}

function isBackSwipe(g: { moveX: number; dx: number; dy: number }): boolean {
  const startX = g.moveX - g.dx;
  return (
    startX < EDGE_WIDTH &&
    g.dx > ACTIVATION_DX &&
    Math.abs(g.dx) > Math.abs(g.dy) * 1.5
  );
}

const EDGE_WIDTH = 28;
const ACTIVATION_DX = 8;
const RELEASE_DX = 80;
