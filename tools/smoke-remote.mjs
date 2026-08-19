// A full match against the live server, over the public internet.
import { WebSocket } from "ws";
const API = "https://api.clashofpokemon.online";
const GAME = "wss://game.clashofpokemon.online";
const content = await (await fetch(`${API}/v1/content`)).json();
const deck = content.cards.filter(c => c.id !== "ditto").slice(0, content.rules.deckSize).map(c => c.id);
async function ticket() {
  const g = await (await fetch(`${API}/v1/auth/guest`, {method:"POST"})).json();
  const s = await (await fetch(`${API}/v1/auth/refresh`, {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({refresh:g.refresh})})).json();
  const t = await (await fetch(`${API}/v1/auth/ticket`, {method:"POST",headers:{authorization:"Bearer "+s.access}})).json();
  return [t.ticket, g.account.id];
}
function seat(t, name) {
  return new Promise((res) => {
    const ws = new WebSocket(GAME + "/");
    const seen = new Set(); let snaps = 0;
    ws.on("open", () => ws.send(JSON.stringify({t:"auth", ticket:t, deck, troop: content.troops[0].id})));
    ws.on("message", (d, bin) => {
      if (bin) { snaps++; return; }
      const m = JSON.parse(String(d)); seen.add(m.t);
      if (m.t === "hello") ws.send(JSON.stringify({t:"loaded"}));
      if (m.t === "start") setTimeout(() => ws.send(JSON.stringify({t:"deploy",seq:1,slot:0,x:144,y:m0seat===1?560:110})), 4000);
      if (m.t === "over") ws.close();
    });
    let m0seat = 1;
    ws.on("close", () => res({name, seen:[...seen], snaps}));
    setTimeout(() => ws.close(), 20000);
  });
}
const [[t1,a1],[t2,a2]] = [await ticket(), await ticket()];
const r = await Promise.all([seat(t1,"one"), seat(t2,"two")]);
for (const s of r) console.log(`${s.name}: messages=${s.seen.join(",")} snapshots=${s.snaps}`);
const rec = await (await fetch(`${API}/v1/users/${a1}`)).json();
console.log("profile from api:", JSON.stringify(rec));
