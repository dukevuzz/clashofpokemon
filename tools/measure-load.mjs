/**
 * How many matches one node can hold.
 *
 * Not "how fast is a step" -- that was measured at 0.032ms and it is the
 * uninteresting half. What decides capacity is whether the shared tick loop
 * still finishes inside its 33ms frame when every match on the node wants a
 * turn, because the moment it does not, *every* match slows down together and
 * nothing errors.
 *
 *   node measure-load.mjs <matches> [seconds]
 */
import { WebSocket } from "ws";

const MATCHES = Number(process.argv[2] ?? 25);
const SECONDS = Number(process.argv[3] ?? 60);
const API = "http://localhost:4500";
const GAME = "ws://localhost:4400";

const content = await (await fetch(`${API}/v1/content`)).json();
const deck = content.cards.filter((c) => c.id !== "ditto")
  .slice(0, content.rules.deckSize).map((c) => c.id);

async function ticket() {
  const guest = await (await fetch(`${API}/v1/auth/guest`, { method: "POST" })).json();
  const session = await (await fetch(`${API}/v1/auth/refresh`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh: guest.refresh }),
  })).json();
  return (await (await fetch(`${API}/v1/auth/ticket`, {
    method: "POST", headers: { authorization: `Bearer ${session.access}` },
  })).json()).ticket;
}

let bytes = 0;
function seat(t) {
  return new Promise((resolve) => {
    const ws = new WebSocket(GAME + "/");
    let seq = 0, side = null, timer;
    ws.on("open", () => ws.send(JSON.stringify({ t: "auth", ticket: t, deck,
      troop: content.troops[0].id })));
    ws.on("message", (d, isBinary) => {
      bytes += d.length;
      if (isBinary) return;
      const m = JSON.parse(String(d));
      if (m.t === "hello") { side = m.seat; ws.send(JSON.stringify({ t: "loaded" })); }
      if (m.t === "start") {
        timer = setInterval(() => ws.send(JSON.stringify({ t: "deploy", seq: ++seq,
          slot: seq % 4, x: 60 + (seq * 37) % 260, y: side === 1 ? 560 : 110 })), 1200);
      }
      if (m.t === "over") { clearInterval(timer); ws.close(); }
    });
    ws.on("close", () => { clearInterval(timer); resolve(); });
    setTimeout(() => { clearInterval(timer); ws.close(); }, SECONDS * 1000);
  });
}

console.log(`starting ${MATCHES} matches (${MATCHES * 2} sockets) for ${SECONDS}s...`);
const started = Date.now();
const all = [];
for (let i = 0; i < MATCHES; i++) {
  // Paired in turn, so the queue seats them two at a time.
  const [a, b] = [await ticket(), await ticket()];
  all.push(seat(a), seat(b));
}

const status = async () => (await (await fetch("http://localhost:4400/status")).json());
await new Promise((r) => setTimeout(r, 3000));
console.log(`running: ${(await status()).matches} matches`);

await Promise.all(all);
const seconds = (Date.now() - started) / 1000;
console.log(`\n${MATCHES} matches for ${seconds.toFixed(0)}s`);
console.log(`traffic: ${(bytes / 1024 / 1024).toFixed(1)} MB total,`
  + ` ${(bytes / seconds / 1024 / 1024 * 8).toFixed(2)} Mbit/s at ${MATCHES} concurrent`);
