/** Where React attaches, and how Phaser hands it control. */

import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";

let host: HTMLElement | undefined;
/** React's own layer. Nothing else may put children here -- React clears it. */
let reactLayer: HTMLElement | undefined;
/** Everything built by hand: dialogs, full-screen panels. */
let manualLayer: HTMLElement | undefined;
let root: Root | undefined;

/** Match the canvas, which Scale.FIT letterboxes inside the window. */
function fit() {
  const canvas = document.querySelector("canvas");
  if (!host || !canvas) return;
  const r = canvas.getBoundingClientRect();
  // A zero-sized canvas means Phaser has not laid out yet; leaving the host at
  // its previous size is better than collapsing it to nothing.
  if (r.width < 1 || r.height < 1) return;
  host.style.left = `${r.left}px`;
  host.style.top = `${r.top}px`;
  host.style.width = `${r.width}px`;
  host.style.height = `${r.height}px`;
}

function ensureHost(): HTMLElement {
  if (host) return host;
  host = document.createElement("div");
  host.id = "react-root";
  host.style.position = "fixed";
  // Nothing is mounted yet, so the host must not eat taps meant for the board.
  // Each screen turns pointer events back on for itself.
  host.style.pointerEvents = "none";
  // Two layers inside the one measured box. They must be separate elements:
  // `createRoot` owns its container's children and clears them on every render,
  // so a dialog appended alongside a React tree would vanish on the next state
  // change.
  const layer = () => {
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;inset:0";
    return el;
  };
  reactLayer = layer();
  manualLayer = layer();
  host.append(reactLayer, manualLayer);
  document.body.append(host);
  fit();

  window.addEventListener("resize", fit);
  window.addEventListener("orientationchange", fit);
  // A phone's viewport changes when the URL bar hides, and that fires neither
  // of the above on iOS.
  if (typeof ResizeObserver !== "undefined") {
    const canvas = document.querySelector("canvas");
    if (canvas) new ResizeObserver(fit).observe(canvas);
  }
  return host;
}

/** The box that sits over the canvas, for anything that is not React. */
export function overlayHost(): HTMLElement {
  ensureHost();
  return manualLayer!;
}

/** Draw a React tree over the canvas. Replaces whatever was there. */
export function mount(node: ReactNode) {
  ensureHost();
  root ??= createRoot(reactLayer!);
  root.render(node);
  fit();
}

/** Take it down. Safe when nothing is mounted. */
export function unmount() {
  root?.render(null);
}
