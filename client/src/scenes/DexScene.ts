/** The Pokedex: every species the game knows, searchable. */

import Phaser from "phaser";
import { SPECIES, typesOf, TYPE_COLORS, TYPE_SHORT } from "../core/species";
import * as tiers from "../core/tiers";
import * as cards from "../core/cards";
import * as evolution from "../core/evolution";
import { towerRange } from "../core/config";
import { C } from "../ui/theme";
import * as sprites from "../ui/sprites";
import * as portraits from "../ui/portraits";
import { openScreen } from "../ui/modal";
import { skillOf } from "../ui/skillCard";

/** How many rows to build at once. The rest arrive as you reach them. */
const PAGE = 120;

const rgbCss = (rgb?: number[]) =>
  rgb ? `rgb(${rgb.map((v) => Math.round(v * 255)).join(",")})` : "#999";

interface Row {
  id: string;
  name: string;
  rarity: string;
  role: string;
  cost: number;
  types: string[];
  playable: boolean;
  tags: string[];
  haystack: string;
}

export class DexScene extends Phaser.Scene {
  private all: Row[] = [];
  private shown: Row[] = [];
  private query = "";
  private onlyPlayable = false;
  private screen?: { body: HTMLElement; header: HTMLElement; close(): void };
  private listEl?: HTMLElement;
  private detailEl?: HTMLElement;
  private drawn = 0;

  constructor() {
    super("Dex");
  }

  create() {
    this.cameras.main.setBackgroundColor(C.bg);
    this.all = [];
    this.buildRows();

    this.screen = openScreen("POKEDEX", () => this.scene.start("Menu"));

    const search = document.createElement("input");
    search.className = "lr-search";
    search.type = "search";
    search.placeholder = "search name, type, rarity, trait…";
    search.addEventListener("input", () => {
      this.query = search.value.trim().toLowerCase();
      this.refresh();
    });

    const roster = document.createElement("button");
    roster.className = "lr-btn";
    roster.textContent = "Playable only";
    roster.setAttribute("aria-pressed", "false");
    roster.addEventListener("click", () => {
      this.onlyPlayable = !this.onlyPlayable;
      roster.setAttribute("aria-pressed", String(this.onlyPlayable));
      this.refresh();
    });

    const count = document.createElement("span");
    count.className = "lr-sub";
    count.style.cssText = "color:#c3cddf;font-size:.78rem;white-space:nowrap";

    // Order matters: the header already holds the title, and openScreen appends
    // Back last, so these land between the two.
    this.screen.header.insertBefore(search, this.screen.header.lastChild);
    this.screen.header.insertBefore(roster, this.screen.header.lastChild);
    this.screen.header.insertBefore(count, this.screen.header.lastChild);

    this.listEl = document.createElement("div");
    this.listEl.className = "lr-list";
    // Paged rather than virtualised. 1,149 rows is enough that building them
    // all costs a visible pause, and little enough that a scroll-triggered page
    // is simpler and less breakable than recycling nodes by index.
    this.listEl.addEventListener("scroll", () => {
      const el = this.listEl!;
      if (el.scrollTop + el.clientHeight > el.scrollHeight - 400) this.drawPage();
    });

    this.detailEl = document.createElement("div");
    this.detailEl.className = "lr-detail";
    this.detailEl.innerHTML = "<div class='lr-sub'>Pick a creature to see what it does.</div>";

    this.screen.body.append(this.listEl, this.detailEl);
    (this as unknown as { countEl: HTMLElement }).countEl = count;
    this.refresh();

    // A scene that draws nothing still has to clean up after itself: without
    // this the panel outlives the scene and stacks up on the next visit.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.screen?.close());
  }

  private buildRows() {
    for (const [id, info] of Object.entries(SPECIES)) {
      const role = tiers.roleOf(id);
      const rarity = tiers.rarityOf(id);
      const types = typesOf(id);
      const flying = types.includes("FLYING");
      const runner = tiers.isRunner(role, flying);
      const t = tiers.traitsOf(id, towerRange());
      const onRoster = cards.byId(id);
      const tags: string[] = [];
      if (t.jumpsRiver) tags.push("crosses anywhere");
      if (t.flying) tags.push("air");
      if (t.outrangesTower) tags.push("outranges tower");
      if (t.trueDamage) tags.push("true dmg");
      if (onRoster?.copies) tags.push("copies last card");
      if (onRoster?.delivery) tags.push(onRoster.delivery);
      if ((onRoster?.count ?? 1) > 1) tags.push(`x${onRoster!.count} bodies`);

      this.all.push({
        id,
        name: id.charAt(0).toUpperCase() + id.slice(1),
        rarity, role, types, tags,
        haystack: [id, role, rarity, ...types, ...tags].join(" ").toLowerCase(),
        cost: cards.costOf(info, rarity, 1, { wincon: false, jumps: runner, flying }),
        playable: sprites.hasSheet(id),
      });
    }
    this.all.sort((a, b) => a.name.localeCompare(b.name));
  }

  private refresh() {
    const q = this.query;
    this.shown = this.all.filter((r) =>
      (!this.onlyPlayable || r.playable) && (!q || r.haystack.includes(q)));
    const count = (this as unknown as { countEl?: HTMLElement }).countEl;
    if (count) count.textContent = `${this.shown.length} of ${this.all.length}`;
    if (!this.listEl) return;
    this.listEl.replaceChildren();
    this.listEl.scrollTop = 0;
    this.drawn = 0;
    this.drawPage();
  }

  private drawPage() {
    if (!this.listEl || this.drawn >= this.shown.length) return;
    const frag = document.createDocumentFragment();
    for (const r of this.shown.slice(this.drawn, this.drawn + PAGE)) {
      frag.append(this.rowEl(r));
    }
    this.drawn += PAGE;
    this.listEl.append(frag);
  }

  private rowEl(r: Row): HTMLElement {
    const el = document.createElement("div");
    el.className = r.playable ? "lr-row" : "lr-row dim";
    el.setAttribute("role", "button");

    const face = document.createElement("div");
    face.className = "lr-face";
    Object.assign(face.style, portraits.styleFor(r.id, 40));
    el.append(face);

    const id = document.createElement("div");
    id.className = "lr-id";
    const b = document.createElement("b");
    b.textContent = r.name;
    const s = document.createElement("small");
    // The tags are the part worth reading, so they get the line rather than
    // being truncated to two the way the canvas table had to.
    s.textContent = [r.role, r.rarity, ...r.tags].join(" · ");
    id.append(b, s);
    el.append(id);

    const types = document.createElement("div");
    types.className = "lr-types";
    for (const t of r.types.slice(0, 2)) {
      const chip = document.createElement("span");
      chip.textContent = TYPE_SHORT[t] ?? t.slice(0, 3);
      chip.style.background = rgbCss(TYPE_COLORS[t]);
      types.append(chip);
    }
    el.append(types);

    const nums = document.createElement("div");
    nums.className = "lr-nums";
    const info = SPECIES[r.id];
    nums.innerHTML = `<span class="lr-cost">${r.cost}</span>` +
      `<small>${info.hp} hp · ${info.atk} atk</small>`;
    el.append(nums);

    el.addEventListener("click", () => {
      this.listEl?.querySelectorAll("[aria-selected]")
        .forEach((o) => o.removeAttribute("aria-selected"));
      el.setAttribute("aria-selected", "true");
      this.showDetail(r);
    });
    return el;
  }

  private showDetail(r: Row) {
    if (!this.detailEl) return;
    const info = SPECIES[r.id];
    const built = cards.byId(r.id) ?? cards.build(r.id);
    const line = evolution.lineOf(r.id).map((f) =>
      f === r.id ? f.toUpperCase() : f).join("  →  ");
    const skill = built ? skillOf(built) : undefined;

    const esc = (t: string) => t.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"));
    this.detailEl.innerHTML = `
      <h2>${esc(r.name)}</h2>
      <div class="lr-sub">${esc([r.role, r.rarity, r.types.join("/")].join(" · "))}${
        r.playable ? "" : " · no sprite, cannot be played"}</div>
      <dl>
        <dt>health</dt><dd>${info.hp}</dd>
        <dt>attack</dt><dd>${info.atk}</dd>
        <dt>defence</dt><dd>${info.def} / ${info.speDef} special</dd>
        <dt>speed</dt><dd>${info.speed}${
          built ? ` · swings every ${built.attackRate}s` : ""}</dd>
        <dt>reach</dt><dd>${info.range}${built ? ` · ${built.range} units` : ""}</dd>
        <dt>would cost</dt><dd>${r.cost} elixir</dd>
        ${line.includes("→") ? `<dt>line</dt><dd>${esc(line)}</dd>` : ""}
      </dl>
      ${skill ? `<div class="lr-skill"><b>${esc(skill.name)}</b> — ${esc(skill.summary)}` +
        `<br><small>${skill.amount} damage, resisted by ${skill.resist}` +
        ` · every ${skill.every} attacks, about ${skill.seconds.toFixed(1)}s</small></div>` : ""}
    `;
    this.detailEl.scrollTop = 0;
  }
}
