"use strict";
require('dotenv').config({quiet:true});
const fs=require('node:fs'),assert=require('node:assert/strict'),{MongoClient}=require('mongodb');
const {loadBson}=require('./verify-normal-progression');
const {buildMetalCards,buildMetalChest}=require('./lib/metal-cards');
async function main(){
  const backup=process.argv.find(x=>x.startsWith('--backup='))?.slice(9);assert.ok(backup);
  const oldMonsters=loadBson(backup+'/monsters.bson'),oldItems=loadBson(backup+'/items.bson');
  const cards=buildMetalCards(oldMonsters),chest=buildMetalChest(oldMonsters);assert.equal(cards.length,8);
  const c=await MongoClient.connect(process.env.MONGODB_URI);
  try{
    const db=c.db(process.env.MONGODB_DB_NAME||'equipment_game');
    for(const card of [...cards,chest]){assert.ok(!oldItems.some(i=>i.id===card.id));assert.equal(await db.collection('items').countDocuments({id:card.id}),0);}
    for(const m of oldMonsters.filter(m=>cards.some(i=>i.monsterCardOf===m.id)))assert.deepEqual(await db.collection('monsters').findOne({_id:m._id}),m,'Concurrent monster change');
    if(!process.argv.includes('--apply')){console.log(JSON.stringify(cards.map(c=>({name:c.name,skill:c.monsterCardSkill.description}))));return;}
    await db.collection('items').insertMany(structuredClone([...cards,chest]));
    for(const card of cards){const m=oldMonsters.find(m=>m.id===card.monsterCardOf);
      const equipment={...m.equipment,special_1:{itemId:card.id,itemName:card.name}};
      const drops=[...(m.drops||[]),{itemId:card.id,itemName:card.name,chance:1,source:'monster_card'}];
      const r=await db.collection('monsters').updateOne({_id:m._id,equipment:m.equipment,drops:m.drops},{$set:{equipment,drops}});assert.equal(r.matchedCount,1);
      const actual=await db.collection('monsters').findOne({_id:m._id});assert.deepEqual(actual,{...m,equipment,drops});
      const{_id,...item}=await db.collection('items').findOne({id:card.id});assert.deepEqual(item,card);
    }
    assert.deepEqual(await db.collection('maintenanceState').find({}).toArray(),loadBson(backup+'/maintenanceState.bson'));
    const{_id,...liveChest}=await db.collection('items').findOne({id:chest.id});assert.deepEqual(liveChest,chest);
    const report={passed:true,cards:8,chests:1,dropRate:1,monsterCombatUnchanged:true,maintenanceUnchanged:true};
    fs.writeFileSync(backup+'/metal-cards-readback.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  }finally{await c.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
