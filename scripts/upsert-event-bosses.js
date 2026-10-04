"use strict";
require('dotenv').config({quiet:true});
const fs=require('fs'),assert=require('assert/strict');
const {getMongoDb,closeMongoClient}=require('../src/adapters/mongo/createMongoClient');
const {buildEventBossContent}=require('./lib/event-boss-content');
async function main(){
 const db=await getMongoDb(), items=await db.collection('items').find({}).toArray(), hutao=await db.collection('monsters').findOne({id:'event-northwind-hutao'});
 const content=buildEventBossContent(items,hutao);
 const turtle=await db.collection("monsters").findOne({id:"event-island-turtle"});
 const turtleChest=turtle.chestDrops||turtle.drops;
 const turtleADrops=items.filter(i=>i.tier==="A"&&(i.setKey==="island_turtle"||i.setKeys?.includes("island_turtle"))).map(i=>({itemId:i.id,itemName:i.name,chance:4.25}));
 if(!process.argv.includes('--apply')){console.log(JSON.stringify({monster:content.monster.name,items:content.items.map(i=>({id:i.id,name:i.name,tier:i.tier})),privatePreviewOnly:true},null,2));return;}
 const backup=process.argv.find(a=>a.startsWith('--backup='))?.slice(9);assert.ok(backup,'verified backup required');
 for(const name of ['monsters','items','worldBossConfig','worldBossEventState','maintenanceState'])assert.ok(fs.existsSync(backup+'/'+name+'.bson'),'Missing '+name+' backup');
 for(const i of content.items)await db.collection('items').updateOne({id:i.id},{$set:i,$setOnInsert:i.createdAt?{}:{createdAt:i.updatedAt}},{upsert:true});
 await db.collection('monsters').updateOne({id:content.monster.id},{$set:content.monster,$setOnInsert:content.monster.createdAt?{}:{createdAt:content.monster.updatedAt}},{upsert:true});
 await db.collection('monsters').updateOne({id:'event-northwind-hutao'},{$set:{chestDrops:content.hutaoChestDrops}});
 await db.collection('worldBossConfig').updateOne({_id:'mantou_rabbit'},{$set:{value:content.config,updatedAt:new Date().toISOString()}},{upsert:true});
 await db.collection("monsters").updateOne({id:turtle.id},{$set:{chestDrops:turtleChest,drops:[...turtle.drops.filter(d=>!turtleADrops.some(a=>a.itemId===d.itemId)),...turtleADrops]}});
 // Enable only administrator preview. Public and broadcast access remain closed in zones.js.
 await db.collection('worldBossConfig').updateOne({_id:'island_turtle'},{$set:{'value.enabled':true}});
 await db.collection('monsters').updateOne({id:'event-island-turtle'},{$set:{enabled:true}});
 for(const i of content.items){const live=await db.collection('items').findOne({id:i.id});for(const [key,val]of Object.entries(i))assert.deepEqual(live[key],val,i.id+':'+key);}
 const live=await db.collection('monsters').findOne({id:content.monster.id});for(const [key,val]of Object.entries(content.monster))assert.deepEqual(live[key],val,'rabbit:'+key);
 console.log('Readback verified:',content.items.length,'items + rabbit boss + private preview config');
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(closeMongoClient);
