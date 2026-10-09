"use strict";
const assert = require('node:assert/strict');
const { buildCatalogAssets, canonicalMedia, isCollection } = require('../src/services/assets/gameAssetManifest');
(async () => {
 const origin='https://otonashikoi.org', manifest={itemArtAliases:{'/uploads/items/old.png':'/uploads/items/new.png'},itemArtRevision:'test-art'};
 assert.equal(isCollection({itemType:'collection'}),true); assert.equal(isCollection({name:'【圖片】收藏圖'}),true);
 const result=await buildCatalogAssets({origin,manifest,items:[
  {itemType:'collectible',imageUrl:'/uploads/items/private.png',imageThumbnailUrl:'/uploads/items/private-thumb.png'},
  {itemType:'equipment',imageUrl:'/uploads/items/old.png'},
  {itemType:'equipment',imageUrl:'/uploads/items/private.png'},
  {itemType:'equipment',imageUrl:'http://bad-host.example/a.png'},
  {itemType:'equipment',imageUrl:'/api/me/profile'},
 ],documents:[{portraitUrl:'/uploads/npcs/npc.webp',expressions:{smile:{imageUrl:'/uploads/npcs/smile.webp'}}},
  {id:'npc-master-swordsman',portraitUrl:'/npc-art/masters/swordsman.png'},
  {id:'master-warrior',imageUrl:'/monster-art/masters/warrior.png'}],
 readLocal:async()=>({bytes:3,revision:'a'.repeat(64)})});
 assert.deepEqual(result.assets.map(x=>x.url).sort(),['/uploads/items/new.png?art=test-art','/uploads/npcs/npc.webp','/uploads/npcs/smile.webp']);
 assert(result.assets.every(x=>x.integrity&&x.bytes===3));
 assert.equal(result.unavailable.length,0,'unreleased job masters must not count as download failures');
 assert.equal(canonicalMedia('https://cdn.invalid/a.png',manifest,origin),null);
 assert.equal(canonicalMedia('https://otonashikoi.org/uploads/items/old.png',manifest,origin).url,'/uploads/items/new.png?art=test-art');
 const missing=await buildCatalogAssets({origin,manifest,items:[],documents:[{cgUrl:'/uploads/story/cg.webp',portraitUrl:'/uploads/npcs/missing.webp'}],readLocal:async url=>url.includes('missing')?{missing:true}:{bytes:5,revision:'b'.repeat(64)}});
 assert.deepEqual(missing.assets.map(x=>x.url),['/uploads/story/cg.webp']);
 assert.deepEqual(missing.unavailable,['/uploads/npcs/missing.webp']);
 console.log('PASS: collectible original/thumbnail exclusion, shared URLs excluded, canonical item artwork, NPC expressions, local hashes, host/media restrictions');
})().catch(error=>{console.error(error);process.exitCode=1});
