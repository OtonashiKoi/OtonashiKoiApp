"use strict";
/**
 * 古城深處「秘銀」A 防具正名（9 件，含飾品）→ 秘銀套(mithril)。
 * 三區各有專屬外觀：秘銀(深處) / 龍鱗(龍族) / 焰鱗(火焰)。
 * 掛進古城深處各怪掉落(取代原鋼鐵防具)。可重複執行。 dry-run 支援。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const NOW = new Date().toISOString();
const S6 = (o = {}) => ({ str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0, ...o });
const ARMOR = [
  ["armor","秘銀鎧",{vit:15}],["head_top","秘銀盔",{vit:13}],["shoes","秘銀戰靴",{agi:5,vit:8}],
  ["shield","秘銀盾甲",{vit:14}],["garment","秘銀披風",{agi:1,vit:11}],["head_mid","秘銀護目",{vit:9,str:3}],
  ["head_low","秘銀護面",{str:2,vit:9}],["accessory_l","秘銀戒指(左)",{str:3,luk:2}],["accessory_r","秘銀戒指(右)",{str:3,vit:2}],
];
const MONSTER_PIECES = {
  "城牆衛兵":["armor","accessory_l"],"冰封騎士":["head_top"],"鐵甲衛將":["shoes","shield"],
  "古城狂戰士":["garment","head_mid"],"黑焰巫師":["head_low","accessory_r"],
};
function armorDoc(id,name,slot,stats,desc){return{id,name,itemType:"equipment",tier:"A",equipSlot:slot,weaponType:null,isTwoHanded:false,atkStat:null,equipStats:S6(stats),effect:{type:"none",value:0},passiveEffects:[],procEffects:[],combatEffects:[],useEffects:[],setKeys:["mithril"],setKey:"mithril",setName:"秘銀套裝",imageUrl:null,imageThumbnailUrl:null,description:desc,createdAt:NOW,updatedAt:NOW};}
(async()=>{const dry=process.argv.includes("--dry-run");const db=await getMongoDb();let items=0,drops=0;
console.log(`秘銀 A 防具（dryRun=${dry}）`);
for(const [slot,name,stats] of ARMOR){const desc="A 階秘銀防具。【秘銀套裝】：最終傷害/對BOSS/掉落率（穿 3/5/7 件）。";if(!dry)await db.collection("items").updateOne({id:`mithril-arm-${slot}`},{$set:armorDoc(`mithril-arm-${slot}`,name,slot,stats,desc)},{upsert:true});items++;console.log(`  ${name} ${slot} ${JSON.stringify(stats)}`);}
const sn=Object.fromEntries(ARMOR.map(([s,n])=>[s,n]));
for(const [mName,slots] of Object.entries(MONSTER_PIECES)){const m=await db.collection("monsters").findOne({zone:"ancient_city_deep",name:mName});if(!m){console.log("SKIP",mName);continue;}let d=(m.drops||[]).filter(x=>!/鋼鐵/.test(x.itemName||""));for(const slot of slots){const id=`mithril-arm-${slot}`;if(!d.find(x=>x.itemId===id))d.push({itemId:id,itemName:sn[slot],chance:1.8});drops++;}if(!dry)await db.collection("monsters").updateOne({_id:m._id},{$set:{drops:d,updatedAt:NOW}});console.log(`  ${mName} → ${slots.map(s=>sn[s]).join("、")} @1.8%(清鋼鐵)`);}
console.log(`${dry?"[DRY-RUN] ":""}完成：秘銀防具 ${items} 件、掉落點 ${drops}`);process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
