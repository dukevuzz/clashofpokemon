import { describe, it, expect, vi } from "vitest";
import { useSwipe } from "../src/ui/useSwipe";

/** `useSwipe` only uses a ref, so it can be driven without a renderer. */
let stored: { current?: unknown } = {};
vi.mock("react", () => ({ useRef: () => stored }));

function swipe(dx: number, dy: number, slow = false) {
  const left = vi.fn(), right = vi.fn();
  stored = { current: undefined };
  const h = useSwipe(left, right);
  h.onPointerDown({ clientX: 100, clientY: 100 });
  if (slow) {
    // Reach into the ref rather than mocking the clock: the hook stores the
    // start time there, and moving it back is exactly what a slow drag is.
    (stored.current as { at: number }).at -= 2000;
  }
  h.onPointerUp({ clientX: 100 + dx, clientY: 100 + dy });
  return { left, right };
}

describe("swiping", () => {
  it("moves forward on a left swipe and back on a right one", () => {
    expect(swipe(-90, 0).left).toHaveBeenCalled();
    expect(swipe(90, 0).right).toHaveBeenCalled();
  });

  it("ignores a slipped tap", () => {
    const { left, right } = swipe(-12, 3);
    expect(left).not.toHaveBeenCalled();
    expect(right).not.toHaveBeenCalled();
  });

  it("ignores a scroll", () => {
    // The one that matters: a long collection list is scrolled vertically,
    // and a little sideways drift must not change screen underneath it.
    const { left, right } = swipe(-70, 120);
    expect(left).not.toHaveBeenCalled();
    expect(right).not.toHaveBeenCalled();
  });

  it("ignores a slow drag", () => {
    const { left } = swipe(-200, 0, true);
    expect(left).not.toHaveBeenCalled();
  });

  it("does nothing when a pointer is cancelled mid-way", () => {
    stored = { current: undefined };
    const left = vi.fn();
    const h = useSwipe(left, undefined);
    h.onPointerDown({ clientX: 100, clientY: 100 });
    h.onPointerCancel();
    h.onPointerUp({ clientX: 0, clientY: 100 });
    expect(left).not.toHaveBeenCalled();
  });
});
