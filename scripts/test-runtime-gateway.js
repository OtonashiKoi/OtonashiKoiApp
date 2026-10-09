"use strict";
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { createRuntimeGateway } = require("../src/api/runtimeGateway");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function listen(server, port = 0) { server.listen(port, "127.0.0.1"); await once(server, "listening"); return server.address().port; }
async function close(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
async function main() {
  let writes = 0, connections = 0;
  const origin = http.createServer(async (req, res) => {
    if (req.url === "/sse") { res.writeHead(200, {"Content-Type":"text/event-stream"}); res.write("data: hello\n\n"); return; }
    let body = ""; for await (const chunk of req) body += chunk;
    if (req.method === "POST") writes++;
    if (req.url === "/ambiguous") { req.socket.destroy(); return; }
    if (req.url === "/slow-write") await sleep(150);
    res.end(JSON.stringify({ body, writes }));
  });
  origin.on("connection", () => connections++);
  const port = await listen(origin);
  const gateway = createRuntimeGateway({ port, waitMs: 1500, retryMs: 10, maxWaiting: 20 });
  const base = "http://127.0.0.1:" + await listen(gateway);
  try {
    assert.equal((await fetch(base)).status, 200);
    assert.equal(connections, 1, "one origin connection per request, no discarded probe");
    const inFlight = fetch(base + "/slow-write", { method: "POST", body: "once-before-close" });
    await sleep(40);
    const closed = new Promise(resolve => origin.close(resolve));
    assert.equal((await inFlight).status, 200); await closed;
    const start = performance.now();
    const during = Array.from({length:12}, (_, i) => fetch(base + "/queued", {method:"POST", body:"queued-"+i}));
    await sleep(250); await listen(origin, port);
    const replies = await Promise.all(during); assert.ok(replies.every(r => r.status === 200));
    const bodies = await Promise.all(replies.map(r=>r.json()));
    assert.deepEqual(bodies.map(r=>r.body).sort(),Array.from({length:12},(_,i)=>"queued-"+i).sort());
    assert.equal(writes,13);
    await gateway.pause();
    const held=fetch(base+"/paused",{method:"POST",body:"held-until-ready"});
    await sleep(80);assert.equal(writes,13);gateway.resume();
    assert.equal((await held).status,200);assert.equal(writes,14);
    const handoffMs=Math.round(performance.now()-start);
    const ambiguous = await fetch(base + "/ambiguous", {method:"POST",body:"do-not-replay"});
    assert.equal(ambiguous.status,503); assert.equal(writes,15);
    const abort = new AbortController();
    const stream = await fetch(base + "/sse", {signal:abort.signal});
    assert.match(new TextDecoder().decode((await stream.body.getReader().read()).value),/hello/); abort.abort();
    await close(origin);
    const abandoned = new AbortController();
    const cancelled = fetch(base + "/queued", {method:"POST",body:"cancelled",signal:abandoned.signal}).catch(()=>null);
    await sleep(30); abandoned.abort(); await cancelled;
    await listen(origin, port); await sleep(80); assert.equal(writes,15);
    await close(origin);
    const timed = await fetch(base); assert.equal(timed.status,503);
    console.log(JSON.stringify({passed:true,queuedWrites:12,duplicateWrites:0,handoffMs,checks:["warm request","write drain","queued original bodies","explicit pause/resume","no ambiguous replay","SSE","abandoned request","bounded outage"]}));
  } finally { gateway.stop(); if(origin.listening) await close(origin); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
