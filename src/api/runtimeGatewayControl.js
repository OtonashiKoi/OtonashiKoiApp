"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const defaultSocket = path.join(os.homedir(), ".otonashikoi-runtime", "gateway.sock");

function notifyGateway(action, socketPath = process.env.GAME_GATEWAY_SOCKET) {
  if (!socketPath) return Promise.resolve({ configured: false });
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: "/" + action, method: "POST", timeout: 14000 }, res => {
      let body = ""; res.on("data", chunk => body += chunk);
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error("Gateway control HTTP " + res.statusCode));
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("Gateway control timeout")));
    req.on("error", reject); req.end();
  });
}

function listenControl(gateway, socketPath = process.env.GAME_GATEWAY_SOCKET || defaultSocket) {
  const control = http.createServer(async (req, res) => {
    try {
      if (req.method !== "POST" || !["/pause", "/resume"].includes(req.url)) { res.writeHead(404);res.end();return; }
      const result = req.url === "/pause" ? await gateway.pause() : gateway.resume();
      res.writeHead(200, {"Content-Type":"application/json"});res.end(JSON.stringify(result));
    } catch (error) { res.writeHead(503);res.end(error.message); }
  });
  fs.mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 });
  // Node removes its own socket on graceful close. PM2 may leave it after a kill;
  // a live listener must be detected before recovering that stale socket.
  control.once("error", error => {
    if (error.code !== "EADDRINUSE") throw error;
    const probe = require("node:net").connect(socketPath);
    probe.once("connect", () => { probe.destroy(); console.error("Gateway control already running"); process.exitCode = 1; gateway.stop(); });
    probe.once("error", probeError => {
      if (probeError.code !== "ECONNREFUSED") throw probeError;
      fs.unlinkSync(socketPath); control.listen(socketPath);
    });
  });
  control.on("listening", () => fs.chmodSync(socketPath, 0o600));
  control.listen(socketPath);
  gateway.once("close", () => control.close());
  return control;
}
module.exports = { notifyGateway, listenControl, defaultSocket };
