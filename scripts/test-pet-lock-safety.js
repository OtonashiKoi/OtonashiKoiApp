'use strict';
const assert = require('node:assert/strict');
(async () => {
 const {MongoMemoryServer}=require('mongodb-memory-server');const mongo=await MongoMemoryServer.create();
 process.env.JWT_SECRET='isolated-pet-lock-test-secret';
 process.env.MONGODB_URI=mongo.getUri();process.env.MONGODB_DB_NAME='qa_pet_lock_safety';
 const {getMongoDb,closeMongoClient}=require('../src/adapters/mongo/createMongoClient');
 try {
  const db=await getMongoDb(),sc=require('../src/services/createServiceContext').createServiceContext(),pid='pet-lock-owner',other='pet-lock-other';
  await sc.playerService.ensurePlayer(pid,pid);await sc.playerService.ensurePlayer(other,other);
  const repo=sc.progressRepository,svc=sc.petService;
  const pet={uuid:'king-slime',petId:'king-slime',speciesName:'王史萊姆',stage:'grown',rarity:'A',satiety:100,lastSatietyAt:Date.now(),lastSettleAt:Date.now(),accruedItems:[]};
  const reset=async()=>{await db.collection('auctions').deleteMany({sellerId:pid});await db.collection('progress').updateOne({playerId:pid},{$set:{pets:[{...pet}],activePetUuid:null,inventory:[]}});};
  const raw=()=>db.collection('progress').findOne({playerId:pid});let count=0;
  const test=async(name,fn)=>{await reset();await fn();count++;console.log('PASS',name);};
  await test('ownership and boolean validation',async()=>{await assert.rejects(svc.setPetLocked(other,pet.uuid,true));await assert.rejects(svc.setPetLocked(pid,pet.uuid,'false'));});
  await test('lock persists and API view exposes it',async()=>{await svc.setPetLocked(pid,pet.uuid,true);assert.equal((await svc.getPetState(pid)).pets[0].locked,true);});
  await test('locked release is rejected without deleting',async()=>{await svc.setPetLocked(pid,pet.uuid,true);await assert.rejects(svc.releasePet(pid,pet.uuid));assert.equal((await raw()).pets.length,1);});
  await test('locked auction rejected without escrow',async()=>{await svc.setPetLocked(pid,pet.uuid,true);await assert.rejects(sc.auctionService.listPet({sellerId:pid,petUuid:pet.uuid,currency:'gold',price:10000,hours:1}));assert.equal(await db.collection('auctions').countDocuments({sellerId:pid}),0);assert.equal((await raw()).pets.length,1);});
  await test('unlock permits release',async()=>{await svc.setPetLocked(pid,pet.uuid,true);await svc.setPetLocked(pid,pet.uuid,false);await svc.releasePet(pid,pet.uuid);assert.equal((await raw()).pets.length,0);});
  await test('locked pet can activate, rename, settle and deactivate',async()=>{await svc.setPetLocked(pid,pet.uuid,true);await svc.setActivePet(pid,pet.uuid);await svc.renamePet(pid,pet.uuid,'王');await svc.getPetState(pid);await svc.deactivatePet(pid);const p=await raw();assert.equal(p.pets[0].locked,true);assert.equal(p.pets[0].nickname,'王');});
  await test('old battle save cannot erase a newly acquired pet',async()=>{const stale=await repo.findByPlayerId(pid);await db.collection('progress').updateOne({playerId:pid},{$push:{pets:{...pet,uuid:'new-pet'}}});stale.exp=1;await repo.save(stale);assert.equal((await raw()).pets.length,2);});
  await test('old battle save cannot resurrect a released pet',async()=>{const stale=await repo.findByPlayerId(pid);await svc.releasePet(pid,pet.uuid);stale.exp=2;await repo.save(stale);assert.equal((await raw()).pets.length,0);});
  await test('stale general and scoped saves preserve new lock',async()=>{const stale=await repo.findByPlayerId(pid),before=structuredClone(stale.pets);await svc.setPetLocked(pid,pet.uuid,true);stale.pets[0].nickname='王';await repo.save(stale);assert.equal((await raw()).pets[0].locked,true);await repo.updateFields(pid,{pets:stale.pets},{expectedPets:stale.pets});assert.equal((await raw()).pets[0].locked,true);assert.equal(before[0].locked,undefined);});
  await test('stale deletion aborts its simultaneous inventory rewards',async()=>{const stale=await repo.findByPlayerId(pid);await svc.setPetLocked(pid,pet.uuid,true);stale.pets=[];stale.inventory.push({uuid:'bad-reward',itemId:'bad-reward'});await assert.rejects(repo.save(stale),{code:'PET_LOCKED'});assert.equal((await raw()).pets.length,1);assert.equal((await raw()).inventory.length,0);});
  await test('old pet polling cannot erase new pet',async()=>{const stale=await repo.findByPlayerId(pid),before=structuredClone(stale.pets);await db.collection('progress').updateOne({playerId:pid},{$push:{pets:{...pet,uuid:'new-pet'}}});stale.pets[0].satiety=99;await assert.rejects(repo.updateFields(pid,{pets:stale.pets},{expectedPets:before}),{code:'PET_WRITE_CONFLICT'});assert.equal((await raw()).pets.length,2);});
  await test('unlocked auction escrows exactly one pet',async()=>{const a=await sc.auctionService.listPet({sellerId:pid,petUuid:pet.uuid,currency:'gold',price:10000,hours:1});assert.equal(a.status,'active');assert.equal((await raw()).pets.length,0);assert.equal(await db.collection('auctions').countDocuments({sellerId:pid,status:'active'}),1);});
  await test('authenticated HTTP lock and release boundaries',async()=>{
    const express=require('express'),jwt=require('jsonwebtoken'),app=express();app.use(express.json());
    app.use(require('../src/api/routes/playerAppRoutes').createPlayerAppRoutes(sc,null));
    app.use((e,q,s,n)=>s.status(e.status||e.statusCode||500).json({code:e.code,message:e.message}));
    const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    const base='http://127.0.0.1:'+server.address().port,token=jwt.sign({discordId:pid,displayName:pid},process.env.JWT_SECRET,{expiresIn:'5m'});
    try {
      const request=(path,body,auth=true)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
      assert.equal((await request('/api/me/pets/lock',{petUuid:pet.uuid,locked:true},false)).status,401);
      const locked=await request('/api/me/pets/lock',{petUuid:pet.uuid,locked:true});assert.equal(locked.status,200,await locked.text());
      assert.equal((await request('/api/me/pets/release',{petUuid:pet.uuid})).status,400);
      assert.equal((await raw()).pets[0].locked,true);
      assert.equal((await request('/api/me/pets/lock',{petUuid:pet.uuid,locked:false})).status,200);
    } finally {await new Promise(r=>server.close(r));}
  });
  console.log(`PASS ${count} pet lock and persistence scenarios`);
 } finally {await closeMongoClient();await mongo.stop();}
})().catch(e=>{console.error(e);process.exitCode=1});
