"use strict";
const http = require("node:http");
const net = require("node:net");

// Keep the public connection alive during the single authoritative runtime's
// short handoff. Only retry TCP connections before any request bytes are sent.
// Once forwarded, a write is never replayed by this gateway.
function createRuntimeGateway({ host = "127.0.0.1", port = 5566,
  waitMs = 15000, retryMs = 40, maxWaiting = 512 } = {}) {
  let waiting = 0, active = 0, paused = false;
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    if (waiting >= maxWaiting) {
      res.writeHead(503, { "Retry-After": "1" }); res.end("Service busy"); return;
    }
    waiting++;
    let pending = true, timer, socket, upstream, ended = false, counted = false;
    const deadline = Date.now() + waitMs;
    const unqueue = () => { if (pending) { pending = false; waiting--; } };
    const uncount = () => { if (counted) { counted = false; active--; } };
    const cancel = () => {
      if (ended) return;
      ended = true; clearTimeout(timer); unqueue(); uncount();
      upstream?.destroy(); socket?.destroy();
    };
    res.once("close", cancel);
    req.once("aborted", cancel);
    const fail = (message) => {
      if (ended) return;
      unqueue();
      if (res.headersSent) res.destroy();
      else { res.writeHead(503, { "Retry-After": "1" }); res.end(message); }
    };
    const connect = () => {
      if (ended) return;
      if (Date.now() >= deadline) { fail("Service reconnecting"); return; }
      if (paused) { timer = setTimeout(connect, retryMs); return; }
      socket = net.connect({ host, port });
      socket.setTimeout(Math.max(1, deadline - Date.now()), () => socket.destroy(new Error("connect timeout")));
      const beforeConnectError = (error) => {
        if (ended) return;
        if (Date.now() < deadline && ["ECONNREFUSED", "ECONNRESET"].includes(error.code)) {
          timer = setTimeout(connect, retryMs);
        } else fail("Service reconnecting");
      };
      socket.once("error", beforeConnectError);
      socket.once("connect", () => {
        socket.removeListener("error", beforeConnectError);
        socket.setTimeout(0);
        if (paused) { socket.destroy(); timer = setTimeout(connect, retryMs); return; }
        unqueue(); counted = true; active++;
        if (ended) { socket.destroy(); return; }
        const agent = new http.Agent({ keepAlive: false });
        agent.createConnection = () => socket;
        upstream = http.request({ host, port, path: req.url, method: req.method,
          headers: { ...req.headers, connection: "close" },
          agent,
        }, reply => {
          if (String(reply.headers["content-type"] || "").includes("text/event-stream")) uncount();
          res.writeHead(reply.statusCode, reply.headers);
          reply.on("error", () => res.destroy());
          reply.pipe(res);
        });
        upstream.on("error", () => {
          uncount();
          const safeRead = ["GET", "HEAD"].includes(req.method) && !req.headers["transfer-encoding"] && !Number(req.headers["content-length"]);
          if (safeRead && !res.headersSent && !ended && Date.now() < deadline && waiting < maxWaiting) {
            pending = true; waiting++; timer = setTimeout(connect, retryMs);
          } else fail("Request interrupted; check its result before retrying");
        });
        if (req.readableEnded) upstream.end(); else req.pipe(upstream);
      });
    };
    connect();
  });
  server.on("connection", socket => {
    sockets.add(socket); socket.once("close", () => sockets.delete(socket));
  });
  server.on("clientError", (_, socket) => socket.destroy());
  server.requestTimeout = 120000;
  server.headersTimeout = 30000;
  server.keepAliveTimeout = 65000;
  server.pause = async (timeoutMs = 12000) => {
    paused = true;
    const until = Date.now() + timeoutMs;
    while (active > 0 && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10));
    if (active > 0) throw new Error("Active requests did not drain");
    return { paused, active, waiting };
  };
  server.resume = () => { paused = false; return { paused, active, waiting }; };
  server.stop = () => { server.close(); for (const socket of sockets) socket.destroy(); };
  return server;
}

if (require.main === module) {
  const gateway = createRuntimeGateway({ port: Number(process.env.GAME_ORIGIN_PORT || 5566) });
  const port = Number(process.env.GAME_GATEWAY_PORT || 5568);
  require("./runtimeGatewayControl").listenControl(gateway);
  gateway.listen(port, "127.0.0.1", () => console.log(`[RuntimeGateway] listening 127.0.0.1:${port}`));
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => gateway.stop());
}
module.exports = { createRuntimeGateway };
