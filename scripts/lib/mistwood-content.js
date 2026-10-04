"use strict";
const assert = require('node:assert/strict');
const mistwoodArt = require('./mistwood-art-v2.json');
const REVISION = 'mistwood-20260929-v1';
function buildContent(items, monsters) {
  const slots = new Set(['weapon','shield','armor','garment','shoes','head_top','head_mid','head_low','accessory_l','accessory_r']);
  const bases = items.filter(x => x.tier === 'B' && x.itemType === 'equipment' && slots.has(x.equipSlot)
    && (x.setKey === 'basic_b' || /^(迅紋|鬥紋|智紋)/.test(x.name) || /^銀戒指/.test(x.name)) && !x.id.startsWith('mistwood-'));
  assert.ok(bases.length >= 30, 'Missing B equipment sources');
  // Reuse existing B gear. No duplicate equipment is created.
  const gear = bases;
  const specs = [
    ['霧光妖靈', '林地妖靈',30,7500,18,20,8000], ['迷霧古樹','森林古樹',32,9200,20,30,10000],
    ['霧影獵豹','暗夜獵豹',34,8500,23,22,10500], ['霧林巫師','森林巫師',35,8000,21,20,11000],
    ['迷途掠奪者','森林盜賊',37,9500,25,27,12500], ['霧林巨獸','森林之獸',39,11000,28,32,14000],
    ['霧隱守護者(B)','森林古樹',40,28000,30,35,40000],
  ];
  const mobs = specs.map(([name,source,level,maxHp,str,def,expReward], index) => {
    const art = mistwoodArt[`mistwood-monster-${index+1}`]; assert.ok(art?.imageUrl && art?.imageThumbnailUrl, `Missing art: ${name}`);
    const loot = gear.filter((_,i) => index === 6 ? i % 3 === 0 : i % 6 === index || i % 6 === (index+1)%6);
    return { id:`mistwood-monster-${index+1}`, seq:index+1, name, zone:'mistwood', level, maxHp,str,def,
      agi: index===2?16:8, vit:12, int:5, dex:14, luk:3, flatDef:level+12,
      expReward: Math.round(expReward * 0.9),goldReward:index===6?1200:350,spawnRate:index===6?1:10,isBoss:index===6,enabled:true,entryFee:0,
      imageUrl:art.imageUrl,imageThumbnailUrl:art.imageThumbnailUrl || art.imageUrl,
      drops:loot.map(x=>({itemId:x.id,itemName:x.name,chance:index===6?4:1.2})),
      passiveEffects:[],procEffects:[],battleStartEffects:[],skills:[],equipment:{},
      element:'wood',elementLevel:2,contentRevision:REVISION,createdAt:'2026-09-29T09:30:00.000Z',updatedAt:'2026-09-29T09:30:00.000Z' };
  });
  assert.ok(gear.every(x=>mobs.some(m=>m.drops.some(d=>d.itemId===x.id))));
  return {gear,mobs};
}
module.exports = {buildContent,REVISION};
