import { WebSocket } from "ws";
const API = "http://localhost:4500", GAME = "ws://localhost:4400";
const content = await (await fetch(`${API}/v1/content`)).json();
const deck = content.cards.filter(c => c.id !== "ditto").slice(0, content.rules.deckSize).map(c => c.id);
async function ticket() {
  const g = await (await fetch(`${API}/v1/auth/guest`, {method:"POST"})).json();
  const s = await (await fetch(`${API}/v1/auth/refresh`, {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({refresh:g.refresh})})).json();
  return (await (await fetch(`${API}/v1/auth/ticket`, {method:"POST",headers:{authorization:"Bearer "+s.access}})).json()).ticket;
}
for (const t of [await ticket(), await ticket()]) {
  const ws = new WebSocket(GAME + "/");
  ws.on("open", () => ws.send(JSON.stringify({t:"auth", ticket:t, deck, troop: content.troops[0].id})));
  ws.on("message", (d, bin) => { if (!bin && JSON.parse(String(d)).t === "hello") ws.send(JSON.stringify({t:"loaded"})); });
  ws.on("error", () => {});
}
setTimeout(() => process.exit(0), 300000);
