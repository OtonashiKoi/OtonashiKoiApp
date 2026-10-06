'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{BSON}=require('mongodb');
const {loadCompanions,ZONES}=require('../src/services/realtime/starterCompanions');
const root=process.argv[2];assert(root,'snapshot directory required');
const read=name=>{const b=fs.readFileSync(root+'/'+name+'.bson'),rows=[];for(let i=0;i<b.length;){const n=b.readInt32LE(i);rows.push(BSON.deserialize(b.subarray(i,i+n)));i+=n;}return rows;};
(async()=>{let reads=0;const rejectRead=async()=>{reads++;throw Error('NPC must not read the library');};
 const sc={itemService:{listItems:rejectRead},monsterService:{listMonsters:rejectRead}},zones=Object.keys(ZONES);
 const result=await Promise.all([...zones,...zones].map(z=>loadCompanions(sc,z)));
 assert.equal(reads,0);assert(result.every(n=>n.length===2));result[0][0].session={hurt:true};result[0][0].stats.maxHp=0;
 const next=await loadCompanions(sc,zones[0]);assert.equal(next[0].session,undefined);assert(next[0].stats.maxHp>0);assert.equal(reads,0);
 assert.deepEqual(await loadCompanions(sc,'mistwood'),[]);
 const items=read('items'),monsters=read('monsters'),{buildCompanion}=require('../src/services/realtime/starterCompanions');
 for(const zone of zones)for(const npc of await loadCompanions(sc,zone)){const expected=buildCompanion(npc.key,zone,items,monsters);for(const item of Object.values(expected.equipped))for(const key of ['_id','createdAt','updatedAt'])delete item[key];assert.deepEqual(npc,expected,'fixed definitions preserve verified NPC stats/equipment');}
 console.log('PASS fixed 8 NPCs match verified loadouts; concurrent and repeated joins do zero library queries; room state is isolated');
})().catch(e=>{console.error(e);process.exitCode=1;});
