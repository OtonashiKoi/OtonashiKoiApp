'use strict';
require('dotenv').config({quiet:true});
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {MongoClient,BSON}=require('mongodb');
const {SET_DEFS}=require('../src/shared/equipmentSetBonuses');
const {buildItemEffectLines}=require('../src/shared/itemEffectLines');
(async()=>{
 const dir=process.argv.find(a=>a.startsWith('--backup-dir='))?.slice(13);assert.ok(dir&&path.isAbsolute(dir));
 const read=name=>{const bytes=fs.readFileSync(path.join(dir,name+'.bson')),rows=[];for(let p=0;p<bytes.length;){const n=bytes.readInt32LE(p);assert.ok(n>=5&&p+n<=bytes.length);rows.push(BSON.deserialize(bytes.subarray(p,p+n)));p+=n;}return rows;};
 const rows=read('items'),keys=['mithril_p','mithril_m','hellfire_p','hellfire_m','steel_p','steel_m'];
 const changes=rows.filter(i=>keys.includes(i.setKey)).map(old=>{
  let description=old.description||'';if(old.tier==='S')description=description.replaceAll('A 階焚獄','S 階焚獄').replaceAll('同時計入 A 階級套裝','同時計入 S 階級套裝');
  description+=' 【現行5件特性】'+SET_DEFS[old.setKey].tiers.find(t=>t.count===5).desc+(old.setKey.startsWith('steel')?'。原生命加成保留；3／7件效果保留。':'。原5件爆傷／魔穿已替換；3／7件效果保留。');
  assert.ok(buildItemEffectLines({...old,description}).some(x=>x.includes(old.setKey.startsWith('mithril')?'精準重擊':old.setKey.startsWith('steel')?'鋼鐵格擋':'焚獄餘燼')));
  return{old,description};
 });
 assert.equal(changes.filter(x=>x.old.tier==='S'&&x.old.equipSlot==='weapon').length,22);
 const c=await MongoClient.connect(process.env.MONGODB_URI);try{const db=c.db(process.env.MONGODB_DB_NAME||'equipment_game');
 assert.deepEqual(await db.collection('maintenanceState').find({}).toArray(),read('maintenanceState'));
 for(const x of changes)assert.deepEqual(await db.collection('items').findOne({_id:x.old._id}),x.old);
 if(!process.argv.includes('--apply'))return console.log(JSON.stringify({preview:true,items:changes.length,sWeapons:22}));
 for(const x of changes)assert.equal((await db.collection('items').updateOne(x.old,{$set:{description:x.description}})).matchedCount,1);
 const expected=new Map(changes.map(x=>[String(x.old._id),{...x.old,description:x.description}]));for(const old of rows)assert.deepEqual(await db.collection('items').findOne({_id:old._id}),expected.get(String(old._id))||old);
 for(const name of ['monsters','maintenanceState'])assert.deepEqual(await db.collection(name).find({}).toArray(),read(name));
 const report={items:changes.length,sWeapons:22,descriptionOnly:true,otherFieldsAndMonstersUnchanged:true,maintenanceUnchanged:true};fs.writeFileSync(path.join(dir,'traits-readback.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await c.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1});
