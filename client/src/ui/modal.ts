/** Dialogs, in the DOM rather than on the canvas. */

import { overlayHost } from "./react-root";

export interface ModalHandle {
  /** Take it down. Safe to call twice; the second call does nothing. */
  close(): void;
  /** The dialog body, for callers that want to keep updating it. */
  readonly body: HTMLElement;
}

export interface ModalOptions {
  title?: string;
  /** Closing on a backdrop click is right for something you are reading and wrong for something you must answer. */
  dismissable?: boolean;
  onClose?: () => void;
  /** Answer it without the game waiting for you. */
  blocking?: boolean;
}

/** Cover the canvas, not the window. */

export function openModal(opts: ModalOptions = {}): ModalHandle {
  const passing = opts.blocking === false;
  const overlay = document.createElement("div");
  overlay.className = passing ? "lr-overlay lr-passthrough" : "lr-overlay";

  const box = document.createElement("div");
  box.className = "lr-modal";
  if (opts.title) {
    const h = document.createElement("h2");
    h.textContent = opts.title;
    box.append(h);
  }
  const body = document.createElement("div");
  box.append(body);
  overlay.append(box);
  overlayHost().append(overlay);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
    opts.onClose?.();
  };

  if (opts.dismissable !== false) {
    overlay.addEventListener("pointerdown", (e) => {
      // Only the backdrop. Without the target test, a click that starts on the
      // dialog and drifts onto the backdrop would close it mid-interaction.
      if (e.target === overlay) close();
    });
  }
  // Swallow everything else, or the pointer lands on the canvas behind and
  // deploys a card into the board the dialog is covering. A non-blocking
  // dialog covers nothing, so there is nothing to protect: the box has its own
  // pointer-events and the rest of the overlay is not there as far as the
  // pointer is concerned.
  if (!passing) overlay.addEventListener("pointerdown", (e) => e.stopPropagation());
  else box.addEventListener("pointerdown", (e) => e.stopPropagation());

  return { close, body };
}

/** A picker: portrait, name, one line under it. Returns nothing; buttons act. */
export function choiceButton(
  opts: {
    /** From portraits.styleFor, so the atlas is reused rather than re-fetched. */
    art?: import("./portraits").PortraitStyle;
    name: string; sub?: string; onPick: () => void;
  },
): HTMLElement {
  const b = document.createElement("button");
  b.className = "lr-choice";
  b.type = "button";
  if (opts.art) {
    const art = document.createElement("div");
    art.className = "lr-art";
    Object.assign(art.style, opts.art);
    b.append(art);
  }
  const n = document.createElement("div");
  n.className = "lr-name";
  n.textContent = opts.name;
  b.append(n);
  if (opts.sub) {
    const s = document.createElement("div");
    s.className = "lr-sub";
    s.textContent = opts.sub;
    b.append(s);
  }
  b.addEventListener("click", opts.onPick);
  return b;
}
