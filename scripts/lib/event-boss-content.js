"use strict";
function buildEventBossContent(items, hutao, now = new Date().toISOString()) {
  if (!hutao) throw Error("Missing Hutao template");
  const originalWeapons = items.filter(i => i.eventBossKey === "northwind_hutao" && i.tier === "S" && i.equipSlot === "weapon");
  if (originalWeapons.length !== 11) throw Error("Expected 11 Hutao main-hand weapons");
  const armor = items.filter(i => i.setKey === "northwind_hutao" && i.tier === "A");
  if (armor.length !== 8) throw Error("Expected 8 A armor templates");
  const weapons = originalWeapons.map(i => {
    const { _id, ...t } = structuredClone(i);
    return { ...t, id: `rabbit-${i.weaponType}`, name: `鬱兔・${({sword_1h:"饅月劍",sword_2h:"蒸籠巨劍",axe_1h:"月牙手斧",axe_2h:"破籠巨斧",mace_1h:"饅頭錘",mace_2h:"蒸氣巨槌",dagger:"兔牙匕首",bow:"月耳長弓",staff_1h:"軟雲杖",staff_2h:"紫霧長杖",dice:"月兔骰"})[i.weaponType]}`,
      description: "爆走饅頭兔的限定武器；土屬性3～4。HP低於30%時，傷害提高10%。",
      requiredLevel:50, eventBossKey:"mantou_rabbit", setKey:"mantou_rabbit", setKeys:[], setName:"鬱兔套裝・爆走",
      passiveEffects:[{key:"bonus_when_hp_low",target:"self",trigger:"passive",chance:100,params:{value:10,thresholdPct:30}}], combatEffects:[], procEffects:[],
      elementDrop:{element:"earth",chancePct:100,minLevel:3,maxLevel:4}, imageUrl:"/uploads/monsters/mantou-rabbit-original.gif",imageThumbnailUrl:"/uploads/monsters/mantou-rabbit-original.gif",updatedAt:now };
  });
  const gear = armor.map(i => {
    const {_id,...t}=structuredClone(i);
    return {...t,id:`rabbit-set-${i.equipSlot}`,name:`鬱兔・${({head_top:"兔耳饅頭冠",head_mid:"厚框閱讀鏡",head_low:"饅香面紗",armor:"軟雲衣",garment:"蒸氣披肩",shoes:"兔躍靴",accessory_l:"月餅左戒",accessory_r:"饅月右戒"})[i.equipSlot]}`,
      requiredLevel:40,eventBossKey:"mantou_rabbit",setKey:"mantou_rabbit",setKeys:[],setName:"鬱兔套裝・爆走", description:"土屬性鬱兔防具。3件最大HP+8%；5件減傷8%；7件爆走輪轉：委屈3回合減傷12%、爆走3回合最終傷害+18%。",passiveEffects:[],procEffects:[],combatEffects:[],
      elementDrop:{element:"earth",chancePct:100,minLevel:2,maxLevel:3},imageUrl:"/uploads/monsters/mantou-rabbit-original.gif",imageThumbnailUrl:"/uploads/monsters/mantou-rabbit-original.gif",updatedAt:now};
  });
  const card={id:"monster-card-mantou-rabbit",name:"爆走饅頭兔卡",itemType:"equipment",tier:"S",equipSlot:"special",equipStats:{},effect:{type:"none",value:0},passiveEffects:[],procEffects:[],combatEffects:[],useEffects:[],monsterCardOf:"event-mantou-rabbit",eventBossKey:"mantou_rabbit",previewOnly:true,noPetGather:true,
    monsterCardSkill:{key:"mantou_burst",name:"巨饅壓頂",description:"攻擊命中時12%機率召出巨大饅頭壓頂，追加一次自身攻擊力180%的攻擊。",chance:12,trigger:"on_hit",cooldownTurns:0,procEffects:[{key:"proc_extra_hit",target:"enemy",trigger:"on_hit",chance:100,params:{damageMultiplier:1.8}}]},imageUrl:"/uploads/monsters/mantou-rabbit-original.gif",updatedAt:now};
  const {_id,...base}=structuredClone(hutao);
  const monster={...base,id:"event-mantou-rabbit",name:"爆走饅頭兔",zone:"event_boss_rabbit_preview",level:60,maxHp:1800000,str:75,agi:65,vit:70,int:50,dex:70,luk:40,def:40,flatDef:100,defIgnorePct:10,element:"earth",elementLevel:4,equipment:{special_1:card},drops:[...weapons.map(i=>({itemId:i.id,itemName:i.name,chance:5})),...gear.map(i=>({itemId:i.id,itemName:i.name,chance:4.25})),{itemId:card.id,itemName:card.name,chance:1}],imageUrl:"/uploads/monsters/mantou-rabbit-original.gif",imageThumbnailUrl:"/uploads/monsters/mantou-rabbit-original.gif",updatedAt:now};
  monster.chestDrops = monster.drops.filter(d => weapons.some(w => w.id === d.itemId) || d.itemId === card.id);
  const hutaoChestDrops = hutao.drops.filter(d => originalWeapons.some(w => w.id === d.itemId) || d.itemId === "monster-card-northwind-hutao");
  const chests=[{id:"chest-northwind-hutao",name:"北風雀神寶箱",monster:hutao},{id:"chest-mantou-rabbit",name:"鬱兔蒸籠寶箱",monster}].map(c=>({id:c.id,name:c.name,description:"世界王貢獻獎勵；開啟後隨機獲得一件王卡或S主手武器，無S防具。",itemType:"consumable",effect:{type:"open_world_boss_chest",monsterId:c.monster.id,bossName:c.monster.name},useEffects:[],equipSlot:null,imageUrl:c.monster.imageUrl,updatedAt:now}));
  return {monster,hutaoChestDrops,items:[...weapons,...gear,card,...chests],config:{enabled:true,targetZone:"event_boss_rabbit_preview",eliteZoneKey:"event_boss_rabbit_preview",weeklyUnlockKillTarget:1,battleTimeLimitMinutes:120,respawnCooldownMinutes:120,phaseConfig:[{phase:1,hpBelowPercent:70,atkMultiplier:1,defMultiplier:1,agiBonus:0,lightningEnabled:false},{phase:2,hpBelowPercent:30,atkMultiplier:1,defMultiplier:1,agiBonus:0,lightningEnabled:false},{phase:3,hpBelowPercent:0,atkMultiplier:1,defMultiplier:1,agiBonus:0,lightningEnabled:false}]}};
}
module.exports={buildEventBossContent};
