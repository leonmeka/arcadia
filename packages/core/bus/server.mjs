#!/usr/bin/env node
/**
 * Arcadia fleet bus — single source of truth for fleet messages.
 *
 * Messages are kept in a replayable in-memory ring with a monotonic `seq`.
 * Agents poll `/history` with a cursor (reliable delivery, survives agent
 * restarts); shells subscribe to `/stream?watch=` for real-time display.
 *
 *   POST /publish                    {from, to, body, hops?}
 *   GET  /history?agent=X&since=N    messages X should process
 *   GET  /history?watch=X&since=N    all traffic involving X (display)
 *   GET  /stream?agent=X             SSE, processing channel
 *   GET  /stream?watch=X             SSE, observer channel
 *   GET  /health                     {ok, seq, subscribers}
 */
import http from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT || 7474);
const RING_MAX = 1000;

// Seeded from wall clock so seq stays monotonic across server restarts.
let seq = Date.now();
const ring = [];
const subscribers = new Set();

const forAgent = (m, name) => m.from !== name && (m.to === null || m.to === name);
const forWatch = (m, name) => m.from === name || m.to === null || m.to === name;

function publish(message) {
  message.seq = ++seq;
  ring.push(message);
  if (ring.length > RING_MAX) ring.shift();

  for (const sub of subscribers) {
    const match = sub.watch ? forWatch(message, sub.name) : forAgent(message, sub.name);
    if (match) {
      sub.res.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
    }
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res, status, data) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, seq, subscribers: subscribers.size });
    return;
  }

  if (req.method === "GET" && url.pathname === "/history") {
    const watch = url.searchParams.get("watch");
    const agent = url.searchParams.get("agent");
    const name = watch || agent;
    if (!name) {
      json(res, 400, { error: "agent or watch query required" });
      return;
    }
    const since = Number(url.searchParams.get("since") || 0);
    const filter = watch ? forWatch : forAgent;
    const messages = ring.filter((m) => m.seq > since && filter(m, name));
    json(res, 200, { seq, messages });
    return;
  }

  if (req.method === "GET" && url.pathname === "/stream") {
    const watch = url.searchParams.get("watch");
    const agent = url.searchParams.get("agent");
    const name = watch || agent;
    if (!name) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("agent or watch query required");
      return;
    }

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(": connected\n\n");

    const sub = { res, name, watch: Boolean(watch) };
    subscribers.add(sub);

    const heartbeat = setInterval(() => {
      res.write(": ping\n\n");
    }, 25000);

    req.on("close", () => {
      clearInterval(heartbeat);
      subscribers.delete(sub);
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/publish") {
    try {
      const data = JSON.parse(await readBody(req));
      const from = String(data.from || "").trim();
      const body = String(data.body || "").trim();
      const to =
        data.to == null || data.to === "" || data.to === "fleet"
          ? null
          : String(data.to).trim().toLowerCase();
      const hops = Number.isInteger(data.hops) && data.hops > 0 ? data.hops : 0;
      // expect: "reply" (peer should answer) or "none" (fire-and-forget).
      // Fleet broadcasts never demand replies.
      const expect = to === null || data.expect === "none" ? "none" : "reply";

      if (!from || !body) {
        json(res, 400, { error: "from and body required" });
        return;
      }
      if (to === from) {
        json(res, 400, { error: "cannot send to self" });
        return;
      }

      const message = {
        id: randomUUID(),
        from,
        to,
        body,
        hops,
        expect,
        sentAt: new Date().toISOString(),
      };

      publish(message);
      json(res, 202, message);
    } catch {
      json(res, 400, { error: "invalid json" });
    }
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`arcadia-bus listening on :${PORT}`);
});
