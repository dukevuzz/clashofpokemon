/**
 * What one match costs on the wire.
 *
 * The number that matters is not bytes per second in the abstract -- it is
 * bytes per match, because a hosting plan is billed by the month and a match
 * is the unit the game comes in. Everything else is arithmetic from there.
 *
 * Plays a full match with both seats, keeping the board busy on purpose: an
 * empty board is the cheapest possible case and would flatter the answer. The
 * snapshot carries fourteen bytes per creature, so a crowded board is what
 * sets the bill.
 *
 *   node measure-bandwidth.mjs [api] [game]
 */
import { WebSocket } from "ws";

const API = process.argv[2] ?? "http://localhost:4500";
const GAME = process.argv[3] ?? "ws://localhost:4400";

async function player() {
  const guest = await (await fetch(`${API}/v1/auth/guest`, { method: "POST" })).json();
  const session = await (await fetch(`${API}/v1/auth/refresh`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh: guest.refresh }),
  })).json();
  const ticket = await (await fetch(`${API}/v1/auth/ticket`, {
    method: "POST", headers: { authorization: `Bearer ${session.access}` },
  })).json();
  return ticket.ticket;
}

const content = await (await fetch(`${API}/v1/content`)).json();
const deck = content.cards.filter((c) => c.id !== "ditto")
  .slice(0, content.rules.deckSize).map((c) => c.id);

/** One seat: counts every byte it is sent, and plays so the board is not empty. */
function seat(ticket, name) {
  return new Promise((resolve) => {
    const ws = new WebSocket(GAME + "/");
    const stats = { name, down: 0, up: 0, snaps: 0, text: 0, events: 0, seat: null };
    let seq = 0;

    const send = (m) => {
      const s = JSON.stringify(m);
      stats.up += s.length;
      ws.send(s);
    };

    ws.on("open", () => send({ t: "auth", ticket, deck, troop: content.troops[0].id }));

    ws.on("message", (data, isBinary) => {
      stats.down += data.length;
      if (isBinary) { stats.snaps++; return; }
      stats.text++;
      const m = JSON.parse(String(data));
      if (m.t === "hello") { stats.seat = m.seat; send({ t: "loaded" }); }
      if (m.t === "ev") stats.events += m.e.length;
      if (m.t === "start") {
        // Keep something on the board for the whole match. Elixir caps at ten,
        // so trying every second is roughly as fast as it can be spent.
        const bottom = stats.seat === 1;
        stats.timer = setInterval(() => {
          send({ t: "deploy", seq: ++seq, slot: seq % 4,
            x: 60 + (seq * 37) % 260, y: bottom ? 560 : 110 });
        }, 1000);
      }
      if (m.t === "over") { clearInterval(stats.timer); ws.close(); }
    });

    ws.on("close", () => { clearInterval(stats.timer); resolve(stats); });
  });
}

const started = Date.now();
const [a, b] = await Promise.all([seat(await player(), "one"), seat(await player(), "two")]);
const seconds = (Date.now() - started) / 1000;

const perMatch = a.down + b.down + a.up + b.up;
const mb = (n) => (n / 1024 / 1024).toFixed(2);

console.log(`match lasted ${seconds.toFixed(0)}s`);
for (const s of [a, b]) {
  console.log(`  seat ${s.seat}: down ${mb(s.down)} MB (${s.snaps} snapshots,`
    + ` ${s.text} text, ${s.events} events), up ${(s.up / 1024).toFixed(1)} KB`);
}
console.log(`\nper match, both players: ${mb(perMatch)} MB`);
console.log(`per player per second:   ${(a.down / seconds / 1024).toFixed(1)} KB/s`);
console.log(`\n1 TB of transfer  = ${Math.floor(1024 * 1024 / (perMatch / 1024 / 1024)).toLocaleString()} matches`);
console.log(`sustained 10 Mbit = ${Math.floor((10 * 1000 * 1000 / 8) / (perMatch / seconds))} concurrent matches`);
