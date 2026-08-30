/**
 * Horizontal swipe, for screens a thumb navigates.
 *
 * Pointer events rather than touch events, so it works with a trackpad drag
 * and a stylus as well as a finger, and so there is one code path to reason
 * about instead of three.
 *
 * The thresholds are the whole design:
 *
 *   DISTANCE  a swipe has to be a deliberate movement, not a slipped tap.
 *   SLOPE     it has to be more horizontal than vertical, or scrolling a long
 *             list sideways-navigates by accident, which is maddening.
 *   TIME      a slow drag is somebody reading, not somebody navigating.
 */

import { useRef } from "react";

const DISTANCE = 60;
const SLOPE = 1.4;
const TIME = 700;

export interface SwipeHandlers {
  onPointerDown(e: { clientX: number; clientY: number }): void;
  onPointerUp(e: { clientX: number; clientY: number }): void;
  onPointerCancel(): void;
}

export function useSwipe(
  onLeft: (() => void) | undefined,
  onRight: (() => void) | undefined,
): SwipeHandlers {
  const from = useRef<{ x: number; y: number; at: number } | undefined>(undefined);

  return {
    onPointerDown(e) {
      from.current = { x: e.clientX, y: e.clientY, at: Date.now() };
    },
    onPointerCancel() {
      from.current = undefined;
    },
    onPointerUp(e) {
      const start = from.current;
      from.current = undefined;
      if (!start) return;

      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Date.now() - start.at > TIME) return;
      if (Math.abs(dx) < DISTANCE) return;
      if (Math.abs(dx) < Math.abs(dy) * SLOPE) return;

      // Swiping left moves you rightwards along a row of tabs, the way a page
      // turns: the content follows the finger.
      if (dx < 0) onLeft?.();
      else onRight?.();
    },
  };
}
