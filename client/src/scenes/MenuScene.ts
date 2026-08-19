/** The menu. */

import Phaser from "phaser";
import { createElement } from "react";
import { C } from "../ui/theme";
import { joinQueue, serverReachable, matchInProgress } from "../net/session";
import { loadDeck, loadTroop, loadBranch } from "../ui/deckStore";
import { Menu } from "../ui/Menu";
import { mount, unmount } from "../ui/react-root";

export class MenuScene extends Phaser.Scene {
  constructor() {
    super("Menu");
  }

  create() {
    this.cameras.main.setBackgroundColor(C.bg);
    // Queueing takes unbounded time, so it has to say what it is doing -- and
    // it has to say it in the DOM. This menu is an overlay *over* the canvas,
    // so a Phaser text drawn underneath is invisible, which is exactly how
    // pressing PLAY ONLINE came to look like it did nothing.
    let status: string | undefined;
    let rejoinTo: (() => void) | undefined;
    const setStatus = (text: string) => { status = text; draw(); };
    // The online button is only offered once a server has answered, so the
    // public build -- which has none yet -- shows exactly what it can do.
    let canPlayOnline = false;

    /** Open the connection and go wherever it puts us. */
    /** The code for a room this player opened, once the server names it. */
    let inviteCode: string | undefined;

    const startOnline = (invite?: { create: true } | { code: string }) => {
      void joinQueue(
        loadDeck().map((c) => c.id), loadTroop(), loadBranch(),
        {
          onSeat: (seat, net) => {
            unmount();
            this.scene.start("Battle", { seat, net });
          },
          onStart: () => {},
          onEvents: () => {},
          onOver: () => {},
          onNote: (text) => setStatus(text),
          onInvite: (code) => {
            inviteCode = code;
            // A room is open, not a search in progress -- clearing the status
            // stops the screen claiming to be doing two things at once.
            status = undefined;
            draw();
          },
        },
        invite,
      ).catch((err: Error) => setStatus(err.message));
    };

    const draw = () => mount(createElement(Menu, {
      status,
      inviteCode,
      rejoin: rejoinTo,
      go: (scene) => this.scene.start(scene),
      /*
       * No tutorial entry point yet.
       *
       * The scripted tutorial is built and the scene still runs it -- start
       * Battle with `{ tutorial: true }` -- but it is not offered, because it
       * is not good enough to be somebody's first impression of the game. A
       * broken tutorial teaches worse than none. The guide, which is finished,
       * takes the slot it was going to have.
       */
      online: canPlayOnline ? () => startOnline() : undefined,
      host: canPlayOnline ? () => startOnline({ create: true }) : undefined,
      join: canPlayOnline ? (code: string) => startOnline({ code }) : undefined,
    }));

    draw();
    void serverReachable().then(async (up) => {
      if (!up) return;
      canPlayOnline = true;
      // A match left running by a refresh is worth offering before a new one.
      const live = await matchInProgress();
      if (live) {
        rejoinTo = () => { setStatus("rejoining…"); startOnline(); };
        status = `a match is still running — ${live.left}s left`;
      }
      draw();
    });
    // Unmount on the way out, or the menu stays over the battle.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unmount);
  }
}
