/**
 * A wire tap between the browser and whichever server is behind it.
 *
 * The point is to compare two servers using the same client, driven the same
 * way, rather than comparing either against a description of what it should
 * do. The browser suite is already the most realistic driver we have; this
 * writes down every frame it exchanges so two runs can be diffed.
 *
 * It listens on the port the client already looks for, so nothing about the
 * client or the tests changes -- the real server moves aside to another port.
 * HTTP is forwarded too, because the menu asks `/status` and `/me/match`
 * before it will offer to play at all.
 *
 *   node record-proxy.mjs <listen> <target> <out.jsonl>
 */
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { appendFileSync, writeFileSync } from "node:fs";

const [listen, target, out] = process.argv.slice(2);
if (!listen || !target || !out) {
  console.error("usage: record-proxy.mjs <listen-port> <target-port> <out.jsonl>");
  process.exit(1);
}
writeFileSync(out, "");

let seq = 0;
const log = (entry) => appendFileSync(out, JSON.stringify({ n: seq++, ...entry }) + "\n");

/** Forward the two HTTP endpoints the menu needs before it offers to play. */
const http = createServer(async (req, res) => {
  try {
    // Only pass an Origin when the browser sent one. An empty string is not
    // "no origin" -- Spring reads it as a malformed cross-origin request and
    // refuses, so the proxy itself became the thing that broke CORS.
    const upstream = await fetch(`http://localhost:${target}${req.url}`, {
      method: req.method,
      headers: req.headers.origin ? { origin: req.headers.origin } : {},
    });
    const body = await upstream.text();
    log({ dir: "http", url: req.url, status: upstream.status });
    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      // The client is on another origin; without this the menu never offers to
      // play, whichever server is behind here.
      "access-control-allow-origin": "*",
    });
    res.end(body);
  } catch (e) {
    log({ dir: "http", url: req.url, error: String(e) });
    res.writeHead(502).end("{}");
  }
});

const wss = new WebSocketServer({ server: http });
let socketId = 0;

wss.on("connection", (browser) => {
  const id = ++socketId;
  const server = new WebSocket(`ws://localhost:${target}/`);
  const pending = [];

  log({ dir: "open", socket: id });

  server.on("open", () => {
    // With the frame type it arrived as, not whatever `send` guesses.
    //
    // A Buffer sent without this option goes out as a *binary* frame, and the
    // queued frame is always the first one -- `auth`. The Java server refuses
    // binary on a text protocol and closes with 1003, correctly; the Node one
    // accepts it. So this single missing flag made the two servers look
    // wildly different when the only thing that differed was the tap.
    for (const [data, binary] of pending.splice(0)) server.send(data, { binary });
  });

  browser.on("message", (data, isBinary) => {
    // Client frames are always text, and they are the ones worth replaying.
    if (!isBinary) log({ dir: "up", socket: id, text: String(data) });
    if (server.readyState === WebSocket.OPEN) server.send(data, { binary: isBinary });
    else pending.push([data, isBinary]);
  });

  server.on("message", (data, isBinary) => {
    // Snapshots are binary and go out fifteen times a second; recording their
    // contents would drown the trace in the one message that is already
    // checked byte for byte elsewhere. The count is what matters here.
    log(isBinary
      ? { dir: "down", socket: id, binary: data.length }
      : { dir: "down", socket: id, text: String(data) });
    if (browser.readyState === WebSocket.OPEN) browser.send(data, { binary: isBinary });
  });

  const close = (who) => (code, reason) => {
    log({ dir: "close", socket: id, by: who, code, reason: String(reason ?? "") });
    if (browser.readyState === WebSocket.OPEN) browser.close();
    if (server.readyState === WebSocket.OPEN) server.close();
  };
  browser.on("close", close("browser"));
  server.on("close", close("server"));
  server.on("error", (e) => log({ dir: "error", socket: id, message: String(e) }));
});

http.listen(Number(listen), () => console.log(`proxy :${listen} -> :${target} -> ${out}`));
