"use strict";
const {isUnavailableEquipment}=require("../../shared/equipmentAvailability");
const {getParticipationGemTiers,calculateFinalDropChance}=require("./battleRewardRules");
const {ENHANCE_GEM_IDS,GEM_PARTICIPATION_RATE,GEM_PARTICIPATION_DOUBLE_DROP_RATE}=require("./zoneBattleState");
const {toWebDrop}=require("./battleRewardView");
const {normalizeInventoryEntryMongoId}=require("../../shared/inventoryStorage");
const _announceDrops=(...args)=>require("./battlePresentation")._announceDrops(...args);

async function grantLiveDrops(context, singleDropPool, encounterSize) {
  const {sc,state,zoneKey,monster,participants,rewardModsByPid,perPidRewards,progressCache,discordId,displayName,mergedDmg,canSendRewardNotice}=context;
  const journal=require("../realtime/normalLiveJournal");
  const gemConfigs=getParticipationGemTiers(zoneKey,monster).map(tier=>({tier,id:ENHANCE_GEM_IDS[tier]})).filter(g=>g.id);
  const ids=[...new Set([...singleDropPool.map(d=>d.itemId),...gemConfigs.map(g=>g.id)].filter(Boolean))];
  const items=sc.itemRepository.findByIds?await sc.itemRepository.findByIds(ids)
    : (await Promise.all(ids.map(id=>sc.itemRepository.findById(id)))).filter(Boolean);
  const library=new Map(items.map(item=>[item.id,normalizeInventoryEntryMongoId(item)]));
  const makeEntry=item=>{
    const entry={uuid:require('crypto').randomUUID(),itemId:item.id,itemName:item.name,
      itemEffect:item.effect||{type:"none",value:0},useEffects:item.useEffects||[],passiveEffects:item.passiveEffects||[],
      procEffects:item.procEffects||[],combatEffects:item.combatEffects||[],itemType:item.itemType||"consumable",
      imageUrl:item.imageUrl||null,imageThumbnailUrl:item.imageThumbnailUrl||null,equipSlot:item.equipSlot||null,
      equipStats:item.equipStats?{...item.equipStats}:{},weaponType:item.weaponType||null,isTwoHanded:item.isTwoHanded||false,
      atkStat:item.atkStat||null,tier:item.tier||null,monsterCardSkill:item.monsterCardSkill||null,
      enhanceLevel:0,source:"monster_drop",sourceRef:monster.name,purchasedAt:new Date().toISOString()};
    try{require("../enchant/enchantService").rollForEntry(entry);}catch{}
    try{if(item.elementDrop||monster.element)require("../../shared/elementDropRoll").rollElementForEntry(entry,{element:monster.element,maxLevel:monster.elementLevel||1,zone:zoneKey,monsterLevel:monster.level,override:item.elementDrop||null});}catch{}
    return entry;
  };
  const requests=participants.flatMap(pid=>[
    {pid,kind:"drops",make:()=>{
      const entries=[],mod=rewardModsByPid[pid]||{dropMultiplier:1,rareDropMultiplier:1};
      for(let unit=0;unit<encounterSize;unit++)for(const drop of singleDropPool){
        const item=library.get(drop.itemId);if(!item||isUnavailableEquipment(item))continue;
        if(Math.random()*100<calculateFinalDropChance(drop.chance,mod,item))entries.push(makeEntry(item));
      }
      return entries;
    }},
    {pid,kind:"gems",make:()=>{
      const entries=[];
      for(let unit=0;unit<encounterSize;unit++)for(const cfg of gemConfigs){
        const item=library.get(cfg.id);if(!item)continue;
        const chance=Math.min(1,(GEM_PARTICIPATION_RATE[cfg.tier]??.05)+(rewardModsByPid[pid]?.dropPct??0)/100);
        if(Math.random()>=chance)continue;
        const count=Math.random()<(GEM_PARTICIPATION_DOUBLE_DROP_RATE[cfg.tier]??0)?2:1;
        for(let i=0;i<count;i++)entries.push(item);
      }
      return entries;
    }}
  ]);
  const plans=await journal.planMany(sc,zoneKey,state.normalLive.encounterKey,requests);
  const grants=[];
  for(const pid of participants){
    const drops=plans[`${pid}_drops`]||[],gems=plans[`${pid}_gems`]||[];
    if(drops.length)grants.push({playerId:pid,id:journal.rewardId(state,pid,"drops"),entries:drops,seasonKey:progressCache[pid]?.seasonKey});
    if(gems.length)grants.push({playerId:pid,id:journal.rewardId(state,pid,"gems"),seasonKey:progressCache[pid]?.seasonKey,stack:true,
      entries:gems.map(item=>({...item,itemId:item.id,itemName:item.name,uuid:require('crypto').randomUUID(),source:"monster_participation_gem",sourceRef:monster.name,stackCount:1,enhanceLevel:0,purchasedAt:new Date().toISOString()}))});
  }
  const receipts=await journal.grantInventoryBatch(sc,grants);
  for(const pid of participants){
    const drops=receipts[pid]?.[journal.rewardId(state,pid,"drops")]||[];
    const gems=receipts[pid]?.[journal.rewardId(state,pid,"gems")]||[];
    const entries=[...drops,...gems];
    if(perPidRewards[pid]){perPidRewards[pid].drops=entries.map(e=>e.itemName);perPidRewards[pid].dropEntries=entries.map(toWebDrop);}
    if(drops.length&&canSendRewardNotice(pid))_announceDrops(sc,pid,pid===discordId?displayName:(mergedDmg[pid]?.name||pid),monster.name,drops.map(e=>e.itemName),drops,pid===discordId?"kill":"group",false,zoneKey).catch(()=>{});
  }
}

module.exports={grantLiveDrops};
