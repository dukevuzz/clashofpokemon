/** Load what the menu and deck builder need, then hand off. */

import Phaser from "phaser";
import * as sprites from "../ui/sprites";
import * as arena from "../ui/arena";
import * as portraits from "../ui/portraits";
import * as skillFx from "../ui/skillFx";
import * as evolution from "../core/evolution";
import { C, style } from "../ui/theme";
import { DESIGN_W, DESIGN_H } from "../ui/layout";

export class BootScene extends Phaser.Scene {
  private label?: Phaser.GameObjects.Text;
  private bar?: Phaser.GameObjects.Rectangle;

  constructor() {
    super("Boot");
  }

  preload() {
    this.label = this.add
      .text(DESIGN_W / 2, DESIGN_H / 2, "Clash of Pokémon", style(34, C.text, "bold"))
      .setOrigin(0.5);
    this.bar = this.add.rectangle(DESIGN_W / 2, DESIGN_H / 2 + 44, 0, 6, C.elixir);
    this.load.on("progress", (p: number) => this.bar?.setSize(280 * p, 6));

    // No creature sheets. Not one.
    //
    // Boot used to pull all 54 of them -- every roster card, every tower troop,
    // the king -- and none of it is drawn before a match starts. The menu, the
    // deck builder and the Pokedex all show the 40x40 portrait atlas, which is
    // 213 KB for every species in the game against several megabytes for
    // fifty-four animation sheets.
    //
    // BattleScene already loads exactly the chains its two decks can reach, and
    // DeckScene loads the roster for its animated previews. Both are screens
    // you choose to open. The first screen should not pay for them.
    arena.preload(this.load);
    portraits.preload(this.load);
    skillFx.preload(this.load);
  }

  create() {
    this.label?.destroy();
    this.bar?.destroy();

    sprites.init(this.anims, this.textures);
    skillFx.register(this.anims, this.textures);

    // Refusing to evolve into a form we cannot draw is deliberate: an invisible
    // unit is worse than no evolution at all.
    //
    // The test is "does a sheet exist", not "is it loaded right now". Those
    // came apart when loading went lazy, and using the stricter one broke the
    // deck builder: it asks which forms Eevee can become while only the roster
    // is in memory, got an empty list, and offered no branch picker at all.
    // BattleScene.preload loads every form a match can reach before it starts,
    // so by the time an evolution actually fires the texture is there.
    evolution.setDrawableCheck(sprites.hasSheet);
    this.scene.start("Menu");
  }
}
