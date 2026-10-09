"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const cors = require("cors");
const { createCanonicalOriginRedirect } = require("../src/api/canonicalOrigin");

async function main() {
  const app = express();
  app.use(createCanonicalOriginRedirect("https://otonashikoi.org"));
  app.use(cors({ origin: (origin, callback) => {
    if (!origin || origin === "https://otonashikoi.org") return callback(null, true);
    callback(new Error("CORS blocked"));
  } }));
  app.use((_req, res) => res.status(200).send("ok"));
  app.use((_error, _req, res, _next) => res.status(500).send("blocked"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, headers = {}, method = "GET") {
    return new Promise((resolve, reject) => {
      const req = http.request(`${base}${path}`, {
        method, headers: { Host: "otonashikoi.org", ...headers }
      }, res => {
        res.resume();
        res.once("end", () => resolve({ status: res.statusCode, headers: new Headers(res.headers) }));
      });
      req.once("error", reject);
      req.end();
    });
  }
  try {
    for (const path of ["/", "/assets/index.js", "/assets/index.css", "/auth/discord/callback?code=example&state=test"]) {
      const response = await request(path, { Origin: "http://otonashikoi.org", "X-Forwarded-Proto": "http" });
      assert.equal(response.status, 308);
      assert.equal(response.headers.get("location"), `https://otonashikoi.org${path}`);
    }
    assert.equal((await request("/", { "X-Forwarded-Proto": "https", Origin: "https://otonashikoi.org" })).status, 200);
    assert.equal((await request("/", { "X-Forwarded-Proto": "https, http" })).status, 200);
    assert.equal((await request("/", { "X-Forwarded-Proto": "http, https" })).status, 308);
    assert.equal((await request("/", {}, "HEAD")).status, 308);
    assert.equal((await request("/", { Host: "localhost:5566" })).status, 200);
    assert.equal((await request("/", { Host: "unrelated.example" })).status, 200);
    assert.equal((await request("/", { Host: "otonashikoi.org.unrelated.example" })).status, 200);
    assert.equal((await request("/api/payment/callback", {}, "POST")).status, 200);
    assert.equal((await request("/", { "X-Forwarded-Proto": "https", Origin: "http://unrelated.example" })).status, 500);
    for (const url of ["", "invalid", "http://localhost:5566"]) {
      let passed = false;
      createCanonicalOriginRedirect(url)({ method: "GET", headers: {}, protocol: "http" }, {}, () => { passed = true; });
      assert.equal(passed, true);
    }
    console.log("Canonical origin checks passed: HTTP page/assets redirect, HTTPS proxy, OAuth query, HEAD, local hosts, callbacks, CORS.");
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
