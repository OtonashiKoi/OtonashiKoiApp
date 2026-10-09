"use strict";
// 以實戰掉落表產生世界王寶箱機率說明；預設預覽，--apply 才寫入。
// 用法：node scripts/regen-worldboss-chest-desc.js --output=<repository外目錄> [--apply]
require("dotenv").config({quiet:true});
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {MongoClient}=require('mongodb'),{serialize,deserialize}=require('bson');
const {buildMonsterDropPool}=require('../src/services/battle/battleRewardRules');
const {isUnavailableEquipment}=require('../src/shared/equipmentAvailability');
const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);
const apply=process.argv.includes('--apply');
(async()=>{
 assert.ok(output,'--output is required');const dir=path.resolve(output);
 assert.ok(!dir.startsWith(path.resolve(__dirname,'..')+path.sep),'backup must be outside repository');fs.mkdirSync(dir,{recursive:true});
 const client=new MongoClient(process.env.MONGODB_URI);await client.connect();
 try{
  const db=client.db(process.env.MONGODB_DB_NAME||'equipment_game');
  const chests=await db.collection('items').find({'effect.type':'open_world_boss_chest'}).toArray();
  const items=new Map((await db.collection('items').find({}).toArray()).map(i=>[i.id,i]));
  const sc={itemRepository:{findById:async id=>items.get(id)}};const plans=[];
  for(const chest of chests){
   const monster=await db.collection('monsters').findOne({id:chest.effect.monsterId});assert.ok(monster,'missing boss '+chest.id);
   const drops=(await buildMonsterDropPool(sc,monster)).filter(d=>d?.itemId&&Number(d.chance)>0&&!isUnavailableEquipment(d.itemId)&&items.has(d.itemId)&&!isUnavailableEquipment(items.get(d.itemId)));
   const total=drops.reduce((n,d)=>n+Number(d.chance),0);assert.ok(total>0,'empty chest '+chest.id);
   const rows=drops.map(d=>({id:d.itemId,name:items.get(d.itemId).name,pct:Number(d.chance)/total*100}));
   const description=[`【世界王寶箱・機率公開】依${monster.name}現行全部可掉落道具權重，隨機獲得1項：`,...rows.map(r=>`${r.name} ${Number(r.pct.toFixed(4))}%`),'機率顯示經四捨五入；無保底。獎池隨該世界王現行掉落表更新。'].join('\n');
   plans.push({id:chest.id,boss:monster.name,description,rows});
  }
  const tag=Date.now(),backup=Buffer.concat(chests.map(c=>serialize(c))),backupPath=path.join(dir,`chests-${tag}.bson`);
  fs.writeFileSync(backupPath,backup);fs.writeFileSync(path.join(dir,`chests-${tag}.metadata.json`),JSON.stringify({indexes:await db.collection('items').indexes()},null,2));
  const saved=fs.readFileSync(backupPath),parsed=[];for(let off=0;off<saved.length;){const n=saved.readInt32LE(off);parsed.push(deserialize(saved.subarray(off,off+n)));off+=n;}assert.deepEqual(parsed,chests);
  if(apply)for(const plan of plans){const before=chests.find(c=>c.id===plan.id);const result=await db.collection('items').updateOne({id:plan.id,description:before.description},{$set:{description:plan.description}});assert.equal(result.matchedCount,1,'description changed concurrently '+plan.id);const after=await db.collection('items').findOne({id:plan.id});assert.deepEqual(after,{...before,description:plan.description});}
  fs.writeFileSync(path.join(dir,apply?'descriptions-applied.json':'descriptions-preview.json'),JSON.stringify({at:new Date().toISOString(),applied:apply,backupPath,plans},null,2));
  console.log(JSON.stringify({applied:apply,chests:plans.map(p=>({id:p.id,count:p.rows.length})),backupPath},null,2));
 }finally{await client.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
