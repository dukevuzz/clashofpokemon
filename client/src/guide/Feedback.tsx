/**
 * The box you type into when something is wrong.
 *
 * Deliberately the shortest form that could work: pick bug or idea, write a
 * sentence, send. No title, no category tree, no "steps to reproduce" fields.
 * Everything a form demands is a place a frustrated player gives up, and a
 * vague report we actually receive beats a detailed one nobody wrote.
 *
 * The build, screen size and input type are attached automatically, which is
 * most of what those fields would have asked for anyway.
 */

import { useState } from "react";
import * as feedback from "../net/feedback";

type State =
  | { at: "writing" }
  | { at: "sending" }
  | { at: "sent" }
  | { at: "failed"; why: string };

export function Feedback() {
  const [kind, setKind] = useState<feedback.Kind>("bug");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<State>({ at: "writing" });

  const tooShort = message.trim().length < 4;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tooShort || state.at === "sending") return;
    setState({ at: "sending" });
    try {
      await feedback.send(kind, message);
      setState({ at: "sent" });
      setMessage("");
    } catch (err) {
      setState({
        at: "failed",
        why: err instanceof feedback.TooMuch
          ? `You have sent a few already. Try again in about ${Math.ceil(err.retryAfterSeconds / 60)} minutes.`
          : err instanceof feedback.Unreachable
          // Their words are still in the box, so say the thing that makes
          // pressing Send again worth doing.
          ? "Could not reach the server — check your connection and try again. What you wrote is still here."
          : err instanceof feedback.NotYetAvailable
          ? "Reporting is not switched on yet — it is on its way. Sorry, and thank you for trying."
          : err instanceof Error ? err.message : "Could not send that.",
      });
    }
  };

  return (
    <section id="feedback">
      <h2>Bugs &amp; ideas</h2>
      <p className="g-lede">
        Found a bug, or thought of something better? Tell us — a sentence is
        enough: what you were doing, and what happened.
      </p>

      {state.at === "sent" ? (
        <div className="g-sent">
          <p><b>Sent. Thank you.</b></p>
          <p className="g-dim">
            Your build and screen size went with it, so there is nothing else we
            need from you.
          </p>
          <button className="g-send" onClick={() => setState({ at: "writing" })}>
            Send another
          </button>
        </div>
      ) : (
        <form className="g-form" onSubmit={submit}>
          <div className="g-facet">
            <span className="g-facet-name">This is</span>
            <div className="g-facet-pills">
              <button
                type="button"
                className={kind === "bug" ? "g-pill g-pill-on" : "g-pill"}
                aria-pressed={kind === "bug"}
                onClick={() => setKind("bug")}
              >
                a bug
              </button>
              <button
                type="button"
                className={kind === "suggestion" ? "g-pill g-pill-on" : "g-pill"}
                aria-pressed={kind === "suggestion"}
                onClick={() => setKind("suggestion")}
              >
                an idea
              </button>
            </div>
          </div>

          <textarea
            className="g-textarea"
            rows={5}
            maxLength={2000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={kind === "bug"
              ? "Deoxys played the wrong body after I waited before dragging it…"
              : "Let me rename my deck…"}
            aria-label={kind === "bug" ? "Describe the bug" : "Describe your idea"}
          />

          <div className="g-form-foot">
            <button className="g-send" type="submit" disabled={tooShort || state.at === "sending"}>
              {state.at === "sending" ? "Sending…" : "Send"}
            </button>
            <span className="g-dim">{message.length}/2000</span>
            {state.at === "failed" && <span className="g-error">{state.why}</span>}
          </div>
        </form>
      )}
    </section>
  );
}
