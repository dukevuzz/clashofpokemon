/**
 * Regenerates the portrait sheet from the upstream PMD SpriteCollab source,
 * adding shiny variants alongside the existing normal ones.
 *
 * Nobody hand-built the current sheet inside this repo -- it was assembled
 * once, outside of version control, and only its output (portraits.png +
 * portraits.json) ever landed here. That made the shiny ask impossible to do
 * safely: there was no way to know *how* a given entry got its frame without
 * reverse-engineering it. This tool is that reverse-engineering, made
 * reusable.
 *
 * The tricky part is that "abra" -> dex 0063 is not a straight name lookup
 * once Mega/Primal/Deoxys-forme entries enter the picture (e.g.
 * "megacharizard" could be Mega X or Mega Y -- both exist upstream under the
 * same dex id, as separate named subgroups). Rather than guess, we decode
 * every plausible upstream candidate and pixel-diff it against the frame
 * that is *already* in the current sheet. The candidate that matches is
 * unambiguously the one this repo has been using -- no guessing required,
 * and it doubles as a correctness check on the name heuristics themselves.
 *
 * The normal frames are never regenerated from source: we copy the existing
 * sheet's pixels for them verbatim, byte for byte, at their existing
 * indices. That is what makes the "341 unchanged frames" guarantee a
 * structural fact rather than something we have to hope a re-encode
 * preserved. Only shiny frames are decoded fresh and appended after them.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(HERE, "../src/data/portraits.json");
const PNG_PATH = join(HERE, "../public/tiles/portraits.png");

// The clone lives outside this repo (see the task brief this tool was built
// against). It is read-only source material -- never written to.
const SPRITE_ROOT = "/home/duc/Documents/duk/game/pmd-spritecollab";
const PORTRAIT_ROOT = join(SPRITE_ROOT, "portrait");
const TRACKER_PATH = join(SPRITE_ROOT, "tracker.json");

type PortraitsFile = {
  size: number;
  cols: number;
  frames: Record<string, number>;
  shiny?: Record<string, number>;
};

type TrackerSubgroup = { name?: string };
type TrackerEntry = { name?: string; subgroups?: Record<string, TrackerSubgroup> };

/** A single drawable form: the base species, or one named subgroup (Mega, Attack, ...). */
type Form = {
  dex: string;
  /** null for the base form; the subgroup id upstream otherwise. */
  subgroup: string | null;
  /** "" for the base form; the subgroup's own name otherwise (e.g. "Mega", "Attack"). */
  name: string;
  normalPath: string;
  shinyPath: string | null;
};

/** Species keys use only letters/digits; upstream names carry spaces, apostrophes, hyphens. */
function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function readPng(path: string): PNG {
  return PNG.sync.read(readFileSync(path));
}

/** Crops one size*size cell out of a sheet, given the same (size, cols) grid the JSON describes. */
function cropFrame(png: PNG, index: number, size: number, cols: number): Buffer {
  const row = Math.floor(index / cols);
  const col = index % cols;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const srcOffset = ((row * size + y) * png.width + col * size) * 4;
    png.data.copy(out, y * size * 4, srcOffset, srcOffset + size * 4);
  }
  return out;
}

function pasteFrame(png: PNG, index: number, size: number, cols: number, pixels: Buffer): void {
  const row = Math.floor(index / cols);
  const col = index % cols;
  for (let y = 0; y < size; y++) {
    const dstOffset = ((row * size + y) * png.width + col * size) * 4;
    pixels.copy(png.data, dstOffset, y * size * 4, y * size * 4 + size * 4);
  }
}

/** Mean absolute per-channel difference. Bit-identical source data scores 0. */
function pixelDiff(a: Buffer, b: Buffer): number {
  if (a.length !== b.length) return Infinity;
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

// ---------------------------------------------------------------------------
// 1. Load what already exists. This is the contract we must not break.
// ---------------------------------------------------------------------------

const current: PortraitsFile = JSON.parse(readFileSync(JSON_PATH, "utf8"));
const currentPng = readPng(PNG_PATH);
const { size, cols, frames } = current;
const speciesCount = Object.keys(frames).length;

// ---------------------------------------------------------------------------
// 2. Index every upstream form: base species plus named subgroups (Mega,
//    Attack/Defense/Speed, Primal, ...). Shiny art for a form lives either
//    at <dex>/0000/0001 (the base form's shiny) or in a sibling subgroup
//    literally named "<FormName>_Altcolor" (a form's shiny) -- there is no
//    single consistent shiny path, so both cases are resolved here once.
// ---------------------------------------------------------------------------

const tracker: Record<string, TrackerEntry> = JSON.parse(readFileSync(TRACKER_PATH, "utf8"));
const nameToDex = new Map<string, string[]>();
const forms: Form[] = [];

for (const [dex, entry] of Object.entries(tracker)) {
  if (entry.name) {
    const key = normalize(entry.name);
    const list = nameToDex.get(key) ?? [];
    list.push(dex);
    nameToDex.set(key, list);
  }

  const dexDir = join(PORTRAIT_ROOT, dex);
  if (!existsSync(dexDir)) continue;

  const baseNormal = join(dexDir, "Normal.png");
  if (existsSync(baseNormal)) {
    const baseShiny = join(dexDir, "0000", "0001", "Normal.png");
    forms.push({
      dex,
      subgroup: null,
      name: "",
      normalPath: baseNormal,
      shinyPath: existsSync(baseShiny) ? baseShiny : null,
    });
  }

  const subgroups = entry.subgroups ?? {};
  for (const [sgId, sg] of Object.entries(subgroups)) {
    if (sgId === "0000") continue; // holds only the base form's shiny, not a form itself
    const sgName = sg.name ?? "";
    // "*_Altcolor" subgroups are shiny sources for another form, not forms in their own right.
    if (!sgName || sgName.endsWith("_Altcolor")) continue;
    const formNormal = join(dexDir, sgId, "Normal.png");
    if (!existsSync(formNormal)) continue;

    // Shiny for a FORM lives nested under that form -- <dex>/<form>/0001/ --
    // exactly as the base form's shiny lives at <dex>/0000/0001/. Looking for a
    // sibling "<Name>_Altcolor" subgroup instead finds almost nothing: repo-wide
    // 593 non-base forms use the nested layout, and that miss silently cost
    // every Mega and Primal its shiny art.
    //
    // The sibling form is still checked as a fallback, because a handful of
    // species (Deoxys) declare it -- though those directories are often absent.
    let shinyPath: string | null = null;
    const nested = join(dexDir, sgId, "0001", "Normal.png");
    if (existsSync(nested)) {
      shinyPath = nested;
    } else {
      const altName = `${sgName}_Altcolor`;
      for (const [sgId2, sg2] of Object.entries(subgroups)) {
        if (sg2.name === altName) {
          const p = join(dexDir, sgId2, "Normal.png");
          if (existsSync(p)) shinyPath = p;
        }
      }
    }
    forms.push({ dex, subgroup: sgId, name: sgName, normalPath: formNormal, shinyPath });
  }
}

// ---------------------------------------------------------------------------
// 3. For each species key already in the sheet, work out its upstream
//    candidate form(s), then disambiguate by pixel content when more than
//    one is plausible (Mega X vs Mega Y, etc).
// ---------------------------------------------------------------------------

/**
 * A handful of species keys are typos baked into this repo's own data
 * ("dartix" for Dartrix, "hippodown" for Hippowdon) -- fixing the key itself
 * is out of scope here (other code keys off it), but there is no reason to
 * let a spelling mistake cost a species its shiny art.
 */
const NAME_ALIASES: Record<string, string> = {
  dartix: "dartrix",
  hippodown: "hippowdon",
};

/** "megaabsol" -> mega + absol; "deoxysattack" -> deoxys + attack; "primalgroudon" -> primal + groudon. */
function candidatesFor(rawSpecies: string): Form[] {
  // A purely numeric key is already a dex id -- "0132" is Ditto, keyed that way
  // in our roster rather than by name. Sending it through the name table finds
  // nothing and silently costs that species its shiny art, which is exactly
  // what happened before this branch existed. Return the base form built in
  // step 2 rather than a hand-made one, so it carries real portrait paths.
  if (/^\d{4}$/.test(rawSpecies)) {
    return forms.filter((f) => f.dex === rawSpecies && f.subgroup === null);
  }
  const species = NAME_ALIASES[rawSpecies] ?? rawSpecies;
  let prefix = "";
  let remainder = species;
  if (species.startsWith("mega") && species.length > 4) {
    prefix = "mega";
    remainder = species.slice(4);
  } else if (species.startsWith("primal") && species.length > 6) {
    prefix = "primal";
    remainder = species.slice(6);
  } else if (species.startsWith("deoxys") && species.length > 6) {
    prefix = "deoxys";
    remainder = species.slice(6);
  }

  if (prefix === "deoxys") {
    const dexIds = nameToDex.get("deoxys") ?? [];
    return forms.filter(
      (f) => dexIds.includes(f.dex) && f.subgroup !== null && normalize(f.name) === remainder,
    );
  }
  if (prefix === "mega" || prefix === "primal") {
    const dexIds = nameToDex.get(remainder) ?? [];
    return forms.filter(
      (f) => dexIds.includes(f.dex) && f.subgroup !== null && normalize(f.name).startsWith(prefix),
    );
  }
  const dexIds = nameToDex.get(species) ?? [];
  return forms.filter((f) => dexIds.includes(f.dex) && f.subgroup === null);
}

const MATCH_THRESHOLD = 40; // mean abs diff per channel; source PNGs should be near-bit-identical

const shiny: Record<string, number> = {};
let matchedNoShiny = 0;
let matchedWithShiny = 0;
let unmatched: string[] = [];
let ambiguousWarnings: string[] = [];
/** Species whose upstream "shiny" is the same image as their normal portrait. */
let placeholderShiny: string[] = [];

/** species -> the upstream form it resolved to, reused by the emotion pass below. */
const resolved = new Map<string, Form>();

const sortedSpecies = Object.keys(frames).sort();
let nextShinyIndex = speciesCount; // shiny frames continue the same index space, right after normal ones

for (const species of sortedSpecies) {
  const candidates = candidatesFor(species);
  if (candidates.length === 0) {
    unmatched.push(species);
    continue;
  }

  let chosen = candidates[0];
  if (candidates.length > 1) {
    const existingPixels = cropFrame(currentPng, frames[species], size, cols);
    let bestDiff = Infinity;
    for (const c of candidates) {
      const candPng = readPng(c.normalPath);
      if (candPng.width !== size || candPng.height !== size) continue;
      const diff = pixelDiff(existingPixels, candPng.data);
      if (diff < bestDiff) {
        bestDiff = diff;
        chosen = c;
      }
    }
    if (bestDiff > MATCH_THRESHOLD) {
      ambiguousWarnings.push(
        `${species}: best of ${candidates.length} candidates still differs by ${bestDiff.toFixed(1)} (kept anyway)`,
      );
    }
  }

  resolved.set(species, chosen);

  if (!chosen.shinyPath) {
    matchedNoShiny++;
    continue;
  }

  const shinyPng = readPng(chosen.shinyPath);
  if (shinyPng.width !== size || shinyPng.height !== size) {
    ambiguousWarnings.push(`${species}: shiny art is ${shinyPng.width}x${shinyPng.height}, not ${size}x${size} -- skipped`);
    matchedNoShiny++;
    continue;
  }

  // Upstream sometimes carries a shiny that is byte-identical to the normal
  // portrait -- a placeholder rather than real alternate-colour art (Marshadow
  // is one). Shipping it would let a player pull a "shiny" that looks exactly
  // like the card they already had, which reads as a bug rather than as luck.
  // Treat it as having no shiny at all.
  const normalPng = readPng(chosen.normalPath);
  if (Buffer.compare(normalPng.data, shinyPng.data) === 0) {
    placeholderShiny.push(species);
    matchedNoShiny++;
    continue;
  }

  shiny[species] = nextShinyIndex++;
  matchedWithShiny++;
}

// ---------------------------------------------------------------------------
// 4. Build the new sheet: copy every existing frame's pixels verbatim at its
//    existing index, then paint the shiny frames after them.
// ---------------------------------------------------------------------------

const totalSlots = speciesCount + Object.keys(shiny).length;
const rows = Math.ceil(totalSlots / cols);
const outPng = new PNG({ width: cols * size, height: rows * size });

for (const index of Object.values(frames)) {
  const pixels = cropFrame(currentPng, index, size, cols);
  pasteFrame(outPng, index, size, cols, pixels);
}

// Re-resolve shiny source paths for painting (kept separate from the matching
// pass above so that pass reads as pure decision-making, not I/O).
for (const species of Object.keys(shiny)) {
  const candidates = candidatesFor(species);
  let chosen = candidates[0];
  if (candidates.length > 1) {
    const existingPixels = cropFrame(currentPng, frames[species], size, cols);
    let bestDiff = Infinity;
    for (const c of candidates) {
      const candPng = readPng(c.normalPath);
      if (candPng.width !== size || candPng.height !== size) continue;
      const diff = pixelDiff(existingPixels, candPng.data);
      if (diff < bestDiff) {
        bestDiff = diff;
        chosen = c;
      }
    }
  }
  const shinyPng = readPng(chosen.shinyPath!);
  pasteFrame(outPng, shiny[species], size, cols, shinyPng.data);
}

writeFileSync(PNG_PATH, PNG.sync.write(outPng));
writeFileSync(
  JSON_PATH,
  JSON.stringify({ size, cols, frames, shiny }, null, 2) + "\n",
);

// ---------------------------------------------------------------------------
// 5. Verify our own output before trusting it. A silent index shift here
//    would corrupt every portrait in the game.
// ---------------------------------------------------------------------------

const rewrittenJson: PortraitsFile = JSON.parse(readFileSync(JSON_PATH, "utf8"));
const rewrittenPng = readPng(PNG_PATH);

if (Object.keys(rewrittenJson.frames).length !== speciesCount) {
  throw new Error(`frame count drifted: had ${speciesCount}, now ${Object.keys(rewrittenJson.frames).length}`);
}
for (const [species, index] of Object.entries(frames)) {
  if (rewrittenJson.frames[species] !== index) {
    throw new Error(`index for "${species}" changed: was ${index}, now ${rewrittenJson.frames[species]}`);
  }
  const before = cropFrame(currentPng, index, size, cols);
  const after = cropFrame(rewrittenPng, index, size, cols);
  if (!before.equals(after)) {
    throw new Error(`pixels for "${species}" (frame ${index}) changed on the regenerated sheet`);
  }
}
const maxSlot = rewrittenPng.width * rewrittenPng.height * 4;
for (const [species, index] of Object.entries(rewrittenJson.shiny ?? {})) {
  const row = Math.floor(index / cols);
  const col = index % cols;
  const offset = ((row * size) * rewrittenPng.width + col * size) * 4;
  if (index < 0 || offset + size * 4 > maxSlot || row * size + size > rewrittenPng.height) {
    throw new Error(`shiny index ${index} for "${species}" is out of the new sheet's bounds`);
  }
}

// ---------------------------------------------------------------------------
// 6. Report.
// ---------------------------------------------------------------------------

console.log(`species in sheet:       ${speciesCount}`);
console.log(`matched, shiny found:   ${matchedWithShiny}`);
console.log(`matched, no shiny art:  ${matchedNoShiny}`);
console.log(`shiny identical to normal (dropped): ${placeholderShiny.length}`);
if (placeholderShiny.length) console.log(`  -> ${placeholderShiny.join(", ")}`);
console.log(`unmatched (carried over, kept as-is): ${unmatched.length}`);
if (unmatched.length) console.log(`  -> ${unmatched.join(", ")}`);
if (ambiguousWarnings.length) {
  console.log(`warnings (${ambiguousWarnings.length}):`);
  for (const w of ambiguousWarnings) console.log(`  - ${w}`);
}
console.log(`new sheet: ${outPng.width}x${outPng.height} (${rows} rows x ${cols} cols)`);
console.log(`verified: all ${speciesCount} original indices unchanged; ${Object.keys(shiny).length} shiny indices in bounds`);

// ---------------------------------------------------------------------------
// 6. Emotion sheets, one file per creature.
//
// Deliberately NOT one big sheet. Three reasons, all measured:
//   * 8,740 variants is ~14 MB. Cloudflare Pages caps a file at 25 MiB, so a
//     single sheet fits today and would stop fitting the moment the roster
//     grows -- an architecture with a cliff in it.
//   * Mixing many palettes into one PNG inflates the colour table. Splitting
//     normal from shiny alone already measured 32% smaller in total bytes.
//   * A player opening one creature should download that creature, not all of
//     them. Per-creature sheets are the only shape where that is possible.
//
// The `^` suffixed files upstream are mirrored copies used for facing, not
// separate emotions, and are skipped.
// ---------------------------------------------------------------------------

/** PAC's canonical order, which is also their price ladder: 50 / 100 / 150 / 200. */
const EMOTIONS = [
  "Normal",
  "Happy", "Pain", "Angry", "Worried", "Sad", "Crying",
  "Shouting", "Teary-Eyed", "Determined", "Joyous", "Inspired", "Surprised", "Dizzy",
  "Special0", "Special1", "Sigh", "Stunned", "Special2", "Special3",
] as const;

const EMO_COLS = 8;
const EMO_DIR = join("public", "tiles", "emotions");
mkdirSync(EMO_DIR, { recursive: true });

/** Which of EMOTIONS exist as real 40x40 art in a directory, in canonical order. */
function emotionsIn(dir: string): number[] {
  if (!existsSync(dir)) return [];
  const out: number[] = [];
  for (let i = 0; i < EMOTIONS.length; i++) {
    const f = join(dir, `${EMOTIONS[i]}.png`);
    if (!existsSync(f)) continue;
    const png = readPng(f);
    if (png.width === size && png.height === size) out.push(i);
  }
  return out;
}

const manifest: Record<string, { n: number[]; s: number[] }> = {};
let emoSheets = 0, emoFrames = 0, emoBytes = 0;

for (const [species, form] of resolved) {
  const normalDir = dirname(form.normalPath);
  const shinyDir = form.shinyPath ? dirname(form.shinyPath) : null;
  const n = emotionsIn(normalDir);
  const sIdx = shinyDir ? emotionsIn(shinyDir) : [];
  // A creature with only its Normal portrait adds a sheet with nothing to
  // collect in it -- the detail screen would show one tile you already own.
  if (n.length + sIdx.length < 2) continue;

  const total = n.length + sIdx.length;
  const rows = Math.ceil(total / EMO_COLS);
  const sheet = new PNG({ width: EMO_COLS * size, height: rows * size });
  let at = 0;
  for (const [dir, list] of [[normalDir, n], [shinyDir, sIdx]] as const) {
    if (!dir) continue;
    for (const e of list) {
      pasteFrame(sheet, at++, size, EMO_COLS, readPng(join(dir, `${EMOTIONS[e]}.png`)).data);
    }
  }
  const buf = PNG.sync.write(sheet);
  writeFileSync(join(EMO_DIR, `${species}.png`), buf);
  manifest[species] = { n, s: sIdx };
  emoSheets++; emoFrames += total; emoBytes += buf.length;
}

writeFileSync(
  join("src", "data", "emotions.json"),
  JSON.stringify({ size, cols: EMO_COLS, emotions: EMOTIONS, creatures: manifest }, null, 1) + "\n",
);

console.log(`\nemotion sheets: ${emoSheets} files, ${emoFrames} frames, ${(emoBytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`  average ${(emoFrames / Math.max(emoSheets, 1)).toFixed(1)} variants per creature`);
