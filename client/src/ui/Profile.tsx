/**
 * The profile screen.
 *
 * The menu's bar is a handle two lines tall; everything about the player lives
 * here. That split is the point: the home screen's job is to start a match,
 * and the record, the settings, the bug link and three paragraphs of licence
 * text were all competing with it.
 *
 * It is a screen rather than a dialog because it is going to keep growing --
 * an account section, and a collection once packs exist.
 */

import { useState } from "react";
import * as portraits from "./portraits";
import * as profileStore from "./profile";
import * as collection from "./collection";
import type { Profile } from "./profile";
import { loadDeck, loadSettings, saveSettings } from "./deckStore";
import { useSwipe } from "./useSwipe";
import { saveProfile, register, logIn, signOut } from "../net/identity";

export interface ProfileProps {
  back(): void;
}

export function ProfileScreen({ back }: ProfileProps) {
  const [me, setMe] = useState<Profile>(profileStore.current());
  const [picking, setPicking] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(me.name);
  const [problem, setProblem] = useState<string>();
  const [settings, setSettings] = useState(loadSettings());
  const [credits, setCredits] = useState(false);
  const [form, setForm] = useState<"none" | "create" | "signin">("none");
  const deck = loadDeck();

  const face = profileStore.faceOf(me, deck);

  const pick = (id: string | undefined) => {
    profileStore.chooseFace(id);
    setPicking(false);
    setMe(profileStore.current());
    // Offline is the normal case for this game, so a failed save is not an
    // error the player needs to see -- the face is already theirs locally.
    void saveProfile({ avatar: id ?? "" }).catch(() => {});
  };

  const rename = () => {
    const name = draft.trim();
    if (!name) {
      setProblem("a name cannot be empty");
      return;
    }
    setProblem(undefined);
    setRenaming(false);
    saveProfile({ displayName: name })
      .then(() => setMe(profileStore.current()))
      .catch((e: Error) => {
        // Unlike the face, this one has to be said: the player typed
        // something and it did not take.
        setProblem(e.message);
        setRenaming(true);
      });
  };

  const toggleElixir = () => {
    const next = { ...settings, showEnemyElixir: !settings.showEnemyElixir };
    setSettings(next);
    saveSettings(next);
  };

  const swipe = useSwipe(undefined, () => (picking ? setPicking(false) : back()));

  if (picking) {
    return (
      <div className="lr-sheet" {...swipe}>
        <div className="lr-sheet-bar">
          <button className="lr-link" onClick={() => setPicking(false)}>‹ back</button>
          <span>Choose a face</span>
        </div>
        <div className="lr-faces">
          {profileStore.faces().map((c) => (
            <button
              key={c.id}
              className={`lr-face-pick${c.id === face ? " lr-face-on" : ""}`}
              title={c.name}
              onClick={() => pick(c.id)}
            >
              <span
                className="lr-face"
                style={portraits.styleFor(c.sheet, 40, collection.isShiny(c.id))}
              />
            </button>
          ))}
        </div>
        {profileStore.chosenFace() && (
          <button className="lr-link" onClick={() => pick(undefined)}>
            use my Mega slot instead
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="lr-sheet" {...swipe}>
      <div className="lr-sheet-bar">
        <button className="lr-link" onClick={back}>‹ back</button>
        <span>Profile</span>
      </div>

      <button className="lr-bigface" onClick={() => setPicking(true)} title="change your face">
        <span
          className="lr-face"
          style={portraits.styleFor(faceSheet(face), 72, face !== undefined && collection.isShiny(face))}
        />
        <span className="lr-bigface-pen">change</span>
      </button>

      {renaming ? (
        <div className="lr-rename">
          <input
            className="lr-search"
            value={draft}
            maxLength={24}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && rename()}
          />
          <button className="lr-btn" onClick={rename}>SAVE</button>
        </div>
      ) : (
        <button
          className="lr-bigname"
          onClick={() => { setDraft(me.name); setRenaming(true); }}
        >
          {me.name}
          <small>tap to rename</small>
        </button>
      )}
      {problem && <p className="lr-problem">{problem}</p>}

      <div className="lr-stats">
        <span><b>{me.wins}</b>won</span>
        <span><b>{me.losses}</b>lost</span>
        <span><b>{me.winRate ?? "—"}{me.winRate === undefined ? "" : "%"}</b>win rate</span>
      </div>

      {/*
        Said here in full, where the red dot on the menu leads. A guest's only
        proof of ownership is a token in this browser's storage, so there is
        nothing that can recover the account once it is cleared -- and a player
        finds that out at the worst possible moment unless it is said first.
      */}
      {profileStore.atRisk(me) && form === "none" && (
        <div className="lr-atrisk">
          <b>Guest — not saved</b>
          <p>
            Clear this browser and this account is gone
            {me.played > 0
              ? `, along with your ${me.played} ${me.played === 1 ? "match" : "matches"}`
              : ""}
            . Nothing can bring it back.
          </p>
          <button className="lr-btn" onClick={() => setForm("create")}>
            CREATE AN ACCOUNT
          </button>
          <button className="lr-link" onClick={() => setForm("signin")}>
            or sign in to one you already have
          </button>
        </div>
      )}

      {form !== "none" && (
        <AccountForm
          mode={form}
          me={me}
          cancel={() => setForm("none")}
          done={() => { setForm("none"); setMe(profileStore.current()); }}
        />
      )}

      {/* Signed in: the way out, and the only place it is offered. */}
      {!me.guest && me.saved && (
        <div className="lr-signedin">
          <p>
            Signed in{me.username ? <> as <b>{me.username}</b></> : null}. This
            account is on the server, so it survives this browser.
          </p>
          <button
            className="lr-link"
            onClick={() => {
              signOut();
              profileStore.afterAuth("signout");
              setMe(profileStore.current());
            }}
          >
            sign out of this device
          </button>
        </div>
      )}

      <div className="lr-settings">
        <button className="lr-setting" onClick={toggleElixir}>
          Show opponent elixir <span>{settings.showEnemyElixir ? "on" : "off"}</span>
        </button>
        <a className="lr-setting" href="./guide.html#feedback" target="_blank" rel="noopener">
          Report a bug <span>›</span>
        </a>
        <button className="lr-setting" onClick={() => setCredits(!credits)}>
          Credits and licences <span>{credits ? "−" : "+"}</span>
        </button>
      </div>

      {/*
        The full text, here rather than on the home screen.
 
        It was three paragraphs competing with the play button, and it is read
        once. Moved, not removed: the sprite licence asks for credit, and a
        credit nobody can reach is not one. CC BY-NC also asks that changes be
        noted -- the frames were repacked into atlases, nothing was redrawn.
      */}
      {credits && (
        <div className="lr-credits">
          <p>
            Pokémon © 1995–2026 Nintendo / Creatures Inc. / GAME FREAK inc.
            Pokémon and Pokémon character names are trademarks of Nintendo.
          </p>
          <p>
            A non-commercial fan project, not affiliated with, endorsed by or
            associated with Nintendo, The Pokémon Company, Creatures Inc. or
            GAME FREAK inc. No money is made from this game and none is asked
            for.
          </p>
          <p>
            Creature sprites by{" "}
            <a href="https://sprites.pmdcollab.org/" target="_blank" rel="noopener">
              PMD Sprite Collab
            </a>
            , used under{" "}
            <a
              href="https://creativecommons.org/licenses/by-nc/4.0/"
              target="_blank"
              rel="noopener"
            >
              CC BY-NC 4.0
            </a>{" "}
            and repacked into atlases. Towers by Foozle (CC0).
          </p>
          <p>Chest animation by Serial. Interface icons drawn for this game.</p>
        </div>
      )}
    </div>
  );
}

/** A card id is not a sheet name for every card, so resolve it properly. */
function faceSheet(id: string | undefined): string {
  const card = id ? profileStore.faces().find((c) => c.id === id) : undefined;
  return card?.sheet ?? "pikachu";
}

/**
 * Creating an account, or signing into one.
 *
 * One component for both, because they are the same three fields and the same
 * two failure modes, and the difference that matters is stated in the warning
 * rather than in the layout.
 */
function AccountForm({
  mode, me, cancel, done,
}: {
  mode: "create" | "signin";
  me: Profile;
  cancel(): void;
  done(): void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const creating = mode === "create";

  const submit = () => {
    if (busy) return;
    setBusy(true);
    setProblem(undefined);
    const work = creating ? register(username, password) : logIn(username, password);
    work
      .then((account) => {
        // `afterAuth` decides what survives. Registering keeps this device's
        // record; signing in as somebody else does not.
        profileStore.afterAuth(creating ? "register" : "login");
        return account;
      })
      .then(done)
      .catch((e: Error) => setProblem(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="lr-account">
      <b>{creating ? "Create an account" : "Sign in"}</b>
      <p>
        {creating
          ? "Keeps the account you are playing now. Nothing is reset."
          : "Brings that account to this device."}
      </p>

      <input
        className="lr-search"
        placeholder="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={24}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <input
        className="lr-search"
        type="password"
        placeholder="password"
        autoComplete={creating ? "new-password" : "current-password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />

      {/*
        Said before the account exists, not after.

        There is no email on these accounts and so no reset. A password is the
        only thing between this player and losing everything, and finding that
        out later is finding it out too late. The design note stands: the way
        to delete this paragraph is to ship email with registration.
      */}
      {creating && (
        <p className="lr-warn">
          There is no password reset yet. Forget this password and the account
          is gone the same way a guest's is — write it down somewhere.
        </p>
      )}

      {/*
        Signing in replaces whoever is on this device. Worth saying only when
        there is something to lose: a guest with no matches is no loss, and a
        warning about nothing teaches people to ignore warnings.
      */}
      {!creating && me.played > 0 && (
        <p className="lr-warn">
          This device is playing an account with {me.played}{" "}
          {me.played === 1 ? "match" : "matches"} on it. Signing in puts that
          one aside, and a guest cannot be signed back into.
        </p>
      )}

      {problem && <p className="lr-problem">{problem}</p>}

      <div className="lr-account-row">
        <button className="lr-btn" onClick={cancel} disabled={busy}>
          CANCEL
        </button>
        <button
          className="lr-btn lr-btn-go"
          onClick={submit}
          disabled={busy || !username || !password}
        >
          {busy ? "…" : creating ? "CREATE" : "SIGN IN"}
        </button>
      </div>
    </div>
  );
}
