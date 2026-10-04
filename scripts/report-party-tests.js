'use strict';
// Private read-only report. Never write player test evidence into public assets.
require('dotenv').config({quiet:true});
const fs=require('node:fs'),path=require('node:path');const {MongoClient}=require('mongodb');
const option=k=>process.argv.find(a=>a.startsWith('--'+k+'='))?.slice(k.length+3);
const output=option('output'),limit=Number(option('limit')||100),run=option('run');
if(!output||!path.isAbsolute(output)||!Number.isInteger(limit)||limit<1||limit>1000)throw Error('Require --output=/absolute/private/report.json; optional --run=ID --limit=1..1000');
(async()=>{const client=await MongoClient.connect(process.env.MONGODB_URI);try{const db=client.db(process.env.MONGODB_DB_NAME||'equipment_game');const runs=await db.collection('partyTowerTestRuns').find(run?{_id:run}:{}).sort({startedAt:-1}).limit(limit).toArray();
 const summary=runs.map(r=>({runId:r._id,status:r.status,difficulty:r.difficulty,startedAt:r.startedAt,endedAt:r.endedAt,clearedFloor:r.clearedFloor,reason:r.reason,players:(r.members||[]).map(m=>{const rows=(r.floors||[]).flatMap(f=>f.players||[]).filter(x=>x.discordId===m.discordId);return{discordId:m.discordId,name:m.name,job:m.job?.name,role:m.towerRole,damage:rows.reduce((n,x)=>n+x.damageDealt,0),auraHealingProvided:rows.reduce((n,x)=>n+x.auraHealingProvided,0),auraHealingReceived:rows.reduce((n,x)=>n+x.auraHealingReceived,0),deaths:(r.floors||[]).flatMap(f=>f.deaths||[]).filter(x=>x.discordId===m.discordId)};})}));
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({generatedAt:new Date().toISOString(),summary,runs},null,2),{flag:'wx'});console.log('Private party test report:',runs.length,'runs');
 }finally{await client.close()}})().catch(e=>{console.error(e.message);process.exitCode=1});
