"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { MongoClient } = require("mongodb");
const { acquireRuntimeLease } = require("../src/services/runtime/runtimeLease");
const { createRuntimeGateway } = require("../src/api/runtimeGateway");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const mongo = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongo.getUri());
  const db = client.db("isolated_runtime_handoff");
  const root = path.resolve(__dirname, "..");
  const preload = path.join(fs.mkdtempSync(path.join(os.tmpdir(),"runtime-handoff-")),"discord-delay.js");
  fs.writeFileSync(preload, `const p=require.resolve(${JSON.stringify(path.join(root,"src/bot/registerCommands"))});require.cache[p]={id:p,filename:p,loaded:true,exports:{registerCommands:async()=>{console.log("TEST_DISCORD_WAIT");await new Promise(r=>setTimeout(r,60000));}}};`);
  const probe = net.createServer(); probe.listen(0,"127.0.0.1"); await once(probe,"listening");
  const port = probe.address().port; await new Promise(r=>probe.close(r));
  const gateway = createRuntimeGateway({port,waitMs:10000}); gateway.listen(0,"127.0.0.1"); await once(gateway,"listening");
  const base = "http://127.0.0.1:"+gateway.address().port;
  const controlSocket=path.join(path.dirname(preload),"gateway.sock");
  const control=require("../src/api/runtimeGatewayControl").listenControl(gateway,controlSocket); await once(control,"listening");
  const children = [], report = {productionWrites:false,checks:[],latencies:[]};
  const boot = (delayedDiscord=false) => {
    const child = spawn(process.execPath,[...(delayedDiscord?["--require",preload]:[]),"src/index.js"],{cwd:root,env:{...process.env,NODE_ENV:"test",API_ONLY:delayedDiscord?"0":"1",DEV_MIRROR:"0",API_PORT:String(port),MONGODB_URI:mongo.getUri(),MONGODB_DB_NAME:db.databaseName,GAME_GATEWAY_SOCKET:controlSocket,JWT_SECRET:"runtime-handoff-isolated-test-secret",DISCORD_TOKEN:"",DISCORD_CLIENT_ID:"",DISCORD_GUILD_ID:"",DISABLE_AUTO_ROTATE:"1"},stdio:["ignore","pipe","pipe"]});
    child.output=""; child.stdout.on("data",x=>child.output+=x);child.stderr.on("data",x=>child.output+=x);
    child.exited=new Promise(resolve=>child.once("exit",(code,signal)=>resolve({code,signal})));children.push(child);return child;
  };
  try {
    const snapshot=process.argv.find(x=>x.startsWith("--snapshot="))?.slice(11);
    if(snapshot)for(const name of ["items","monsters","worldBossConfig","weeklyQuests","shopItems","enchantConfig","gameSeasonState"]){const rows=require("./verify-normal-progression").loadBson(path.join(snapshot,name+".bson"));if(rows.length)await db.collection(name).insertMany(rows);}
    const first=boot(); const initial=performance.now();assert.equal((await fetch(base+"/health")).status,200);report.initialReadyMs=Math.round(performance.now()-initial);
    const record=await db.collection("runtimeLeases").findOne({_id:"game-runtime"});assert.equal(record.pid,first.pid);assert.ok(record.hostId);
    await assert.rejects(()=>acquireRuntimeLease(db),/GAME_RUNTIME_ALREADY_RUNNING/);
    report.checks.push("live local owner cannot be stolen");
    let monitoring=true;const probes=[];
    const monitor=(async()=>{while(monitoring){const t=performance.now();const response=await fetch(base+"/health");probes.push(response.status);report.latencies.push(Math.round(performance.now()-t));await sleep(30);}})();
    first.kill("SIGTERM");assert.equal((await first.exited).code,0);
    const second=boot(true);const switched=performance.now();
    for(let i=0;i<100;i++){const r=await fetch("http://127.0.0.1:"+port+"/health").catch(()=>null);if(r?.status===200)break;await sleep(30);}
    assert.equal((await fetch(base+"/health")).status,200);report.handoffReadyMs=Math.round(performance.now()-switched);
    assert.ok(report.handoffReadyMs<5000,second.output);assert.match(second.output,/TEST_DISCORD_WAIT/);assert.doesNotMatch(second.output,/waiting for previous runtime/);
    report.checks.push("actual SIGTERM to ready under5s with unexpired60s lease and delayed Discord");
    await sleep(120);monitoring=false;await monitor;assert.ok(probes.length>1);assert.ok(probes.every(s=>s===200));report.probeCount=probes.length;
    const token=require("jsonwebtoken").sign({discordId:"isolated-handoff"},"runtime-handoff-isolated-test-secret",{expiresIn:"1m"});
    assert.equal((await fetch(base+"/api/me/anchors",{headers:{Authorization:"Bearer "+token}})).status,200);
    assert.equal((await fetch(base+"/api/combat/quick-battle",{method:"POST",headers:{"Content-Type":"application/json"},body:'{"zone":"normal"}'})).status,401);
    report.checks.push("authenticated API and unauthorized write gate after handoff");
    second.kill("SIGKILL");await second.exited;
    const t=performance.now(), lease=await acquireRuntimeLease(db);assert.ok(performance.now()-t<1000);await lease.release();report.checks.push("dead owner after SIGKILL can be reclaimed immediately");
    await db.collection("runtimeLeases").insertOne({_id:"game-runtime",owner:"foreign",hostId:"foreign-host",pid:second.pid,expiresAt:new Date(Date.now()+60000)});
    await assert.rejects(()=>acquireRuntimeLease(db),/GAME_RUNTIME_ALREADY_RUNNING/);report.checks.push("foreign host retains expiry protection");
    await db.collection("runtimeLeases").updateOne({_id:"game-runtime"},{$set:{hostId:record.hostId}});
    const contenders=await Promise.allSettled([acquireRuntimeLease(db),acquireRuntimeLease(db)]);assert.equal(contenders.filter(r=>r.status==="fulfilled").length,1);await contenders.find(r=>r.status==="fulfilled").value.release();report.checks.push("competing replacement processes admit only one owner");
    report.maxRequestMs=Math.max(...report.latencies);report.failedRequests=probes.filter(s=>s!==200).length;report.passed=true;
    const output=process.argv.find(x=>x.startsWith("--output="))?.slice(9);if(output)fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  } finally {const output=process.argv.find(x=>x.startsWith("--output="))?.slice(9);if(output)fs.writeFileSync(output,JSON.stringify(report,null,2));for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill("SIGKILL");await Promise.all(children.map(c=>c.exited));gateway.stop();await client.close();await mongo.stop();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
