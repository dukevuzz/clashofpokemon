/**
 * The guide is its own page, not a scene.
 *
 * It is a document: long, scrollable, linkable, and something a player will
 * want open on a second screen while they play. Phaser can do none of those
 * things, and the DOM does all of them for free.
 *
 * Palette first, before anything renders, so the page never flashes an
 * unstyled colour on the way in -- same call the game makes, from the same
 * source, which is what keeps the two halves agreeing.
 */

import { createRoot } from "react-dom/client";
import { publishPalette } from "../ui/theme";
import * as cards from "../core/cards";
import { facts } from "./facts";
import { Guide } from "./Guide";

publishPalette();

/*
 * What the page was built from, for anything that wants to check the page
 * against it. Nothing here is a secret -- the roster ships in the bundle
 * either way -- and the game exposes `window.lr` for the same reason.
 *
 * It exists so a test can assert the prose agrees with the config *without*
 * writing the config's numbers down a second time, which is the one thing that
 * would let this page drift after a retune.
 */
(window as unknown as Record<string, unknown>).guide = { facts, cards: cards.ALL };

const host = document.getElementById("guide");
if (host) createRoot(host).render(<Guide />);
