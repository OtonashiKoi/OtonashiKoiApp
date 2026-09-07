"use strict";
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const net = require("node:net");
const { MongoMemoryServer } = require("mongodb-memory-server");

async function main() {
  const mongo = await MongoMemoryServer.create();
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  let output = '';
  const child = spawn(process.execPath, ['src/index.js'], { cwd: require('node:path').resolve(__dirname, '..'), env: {
    ...process.env, NODE_ENV: 'test', API_ONLY: '1', DEV_MIRROR: '0', API_PORT: String(port),
    MONGODB_URI: mongo.getUri(), MONGODB_DB_NAME: 'isolated_runtime_boot', DISABLE_AUTO_ROTATE: '1'
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  const exited = new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })));
  try {
    let response;
    for (let n = 0; n < 100; n++) {
      if (child.exitCode !== null) throw Error(`Runtime exited before health: ${child.exitCode}`);
      response = await fetch(`http://127.0.0.1:${port}/health`).catch(() => null);
      if (response?.ok) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(response?.status, 200);
    assert.match(output, /CurrencySettlement.*recovered/);
    assert.match(output, /API_ONLY=1/);
    const denied = await fetch(`http://127.0.0.1:${port}/api/combat/quick-battle`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zone: 'normal' })
    });
    assert.equal(denied.status, 401);
    child.kill('SIGTERM');
    const result = await exited;
    assert.equal(result.code, 0);
    console.log('PASS: actual standalone API_ONLY bootstrap, currency recovery, health, auth guard and graceful shutdown');
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    await exited; await mongo.stop();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
