'use strict';
const { calcPlayerStats } = require('../../src/shared/combatStats');
const { getEnhanceCost, ENHANCE_GEMS } = require('../../src/shared/enhanceConfig');
const { isUnavailableEquipment } = require('../../src/shared/equipmentAvailability');
const { isEffectConditionMet } = require('../../src/shared/effectEngine');
const ja = require('../../src/shared/jobAdvancement');
const { entry } = require('./journey-runtime');
const profiles = {
  swordsman:['str',['sword_1h','sword_2h']],warrior:['str',['axe_1h','axe_2h']],
  dwarf_warrior:['str',['mace_1h','mace_2h']],rogue:['agi',['dagger']],
  mage:['int',['staff_2h']],healer:['int',['staff_1h']],archer:['dex',['bow']],
  tactician:['int',['staff_1h','staff_2h']],bard:['dex',['bow']],
  barrier_mage:['int',['staff_1h','staff_2h']],gambler:['luk',['dice']],
};
const isAcquired=i=>/^(monster_drop|quest)/.test(String(i.source||''));
function matrix(items, definitions) {
  const included=[],excluded=[];
  for(const [baseKey,base] of Object.entries(ja.BASE_JOBS))for(const b of ja.T2_BRANCHES[baseKey]||[]) {
    const quest=definitions.find(q=>q.rewardItemId===b.id&&q.type==='t2_transfer');
    const item=items.find(i=>i.id===b.id),one=definitions.find(q=>q.rewardItemId===base.badgeId&&q.enabled);
    const reason=b.seasonLocked?'本季鎖定':!quest?.enabled?'二轉任務未開':!item||!one?'缺道具或一轉任務':null;
    const row={baseKey,baseName:base.name,t1Badge:base.badgeId,t2Badge:b.id,t2Name:b.name,t1Quest:one?.id,t2Quest:quest?.id,primary:profiles[baseKey][0],weaponTypes:profiles[baseKey][1]};
    (reason?excluded:included).push({...row,...(reason?{reason}:{})});
  }
  return{included,excluded};
}
function gearView(p) {
  return Object.fromEntries(Object.entries(p.equipment).filter(([,i])=>i).map(([s,i])=>[s,{id:i.itemId,name:i.itemName,tier:i.tier,plus:i.enhanceLevel||0,jobLevel:i.jobExp??null}]));
}
function score(p, equipment, zone) {
  const s=calcPlayerStats(p.attributes,equipment,p.activeEffects,p.inventory,{zone});
  return Math.max(1,s.atk)*(s.tierDamageMultiplier||1)*(s.tierFinalDamageMultiplier||1)
    *Math.pow(Math.max(1,s.maxHp),.25)*(1+Math.min(75,s.def||0)/100)*(1+Math.min(75,s.dodge||0)/200);
}
function cardScore(card, p) {
  const context={equipped:p.equipment,inventory:p.inventory};
  const effects=[...(card.passiveEffects||[]),...(card.combatEffects||[]),...(card.procEffects||[])];
  const eventDamage={mistwood_panther_counter:60,mistwood_wizard_echo:13.5,mistwood_beast_stomp:11.25,metal_card_rat:20,metal_card_heavy:8,metal_card_crown:70};
  return effects.reduce((n,e)=>{
    if(!isEffectConditionMet(e,context))return n;
    if(!/damage|attack|atk|crit|combo|poison|burn|bleed|lightning|thunder|reflect|counter/.test(e.key||''))return n;
    if(/down|taken|reduction|cut|heal|reward|gain/.test(e.key||''))return n;
    const chance=Number(e.chance??100)/100,value=Math.abs(Number(e.params?.value??e.value??1));
    return n+chance*(value||1);
  },eventDamage[card.monsterCardSkill?.key]||0);
}
async function equipAndRecycle(r, zone) {
  // Open only genuinely acquired currency/EXP bags through the real service.
  const usable=r.progress.inventory.filter(i=>i.itemType==='consumable'&&['grant_gold','grant_exp'].includes(i.itemEffect?.type));
  for(const id of [...new Set(usable.map(i=>i.itemId))]){
    const uuids=usable.filter(i=>i.itemId===id).map(i=>i.uuid);
    const out=await r.shopService.useConsumableBulk(r.id,uuids,'isolated');r.log('use',{id,...out});
  }
  const p=r.progress,before=gearView(p),wanted=r.route.weaponTypes;
  // Local greedy comparison uses known stats; it never rolls a future battle.
  for(const slot of ['weapon','shield','head_top','head_mid','head_low','armor','garment','shoes','accessory_l','accessory_r']) {
    if(slot==='shield'&&(p.equipment.weapon?.isTwoHanded||['staff_2h','bow','dice','sword_2h','axe_2h','mace_2h'].includes(p.equipment.weapon?.weaponType)))continue;
    const candidates=p.inventory.filter(i=>i.equipSlot===slot&&i.itemType==='equipment'&&isAcquired(i)&&!isUnavailableEquipment(i));
    if(!candidates.length)continue;
    const cur=p.equipment[slot];let best=cur,utility=score(p,p.equipment,zone);
    for(const candidate of candidates) {
      if(slot==='weapon'&&!wanted.includes(candidate.weaponType))continue;
      const eq={...p.equipment,[slot]:candidate};if(slot==='weapon'&&candidate.isTwoHanded)delete eq.shield;
      const n=score(p,eq,zone),force=slot==='weapon'&&!wanted.includes(cur?.weaponType);
      if(n>utility*1.005||force&&best===cur){best=candidate;utility=n;}
    }
    if(best&&best!==cur)await r.shopService.equipItem(r.id,best.uuid,slot);
  }
  // Cards: equip distinct acquired cards with active known effects, not random top-rarity cards.
  const cards=[...p.inventory.filter(i=>i.equipSlot==='special'&&isAcquired(i)),...['special_1','special_2','special_3'].map(k=>p.equipment[k]).filter(Boolean)];
  const ranked=cards.sort((a,b)=>cardScore(b,p)-cardScore(a,p));const unique=[];
  for(const c of ranked)if(!unique.some(i=>i.itemId===c.itemId)&&cardScore(c,p)>0)unique.push(c);
  for(let n=0;n<Math.min(3,unique.length);n++) {
    const c=unique[n];if(Object.values(p.equipment).some(i=>i?.uuid===c.uuid))continue;
    const slot=['special_1','special_2','special_3'].find(k=>!unique.slice(0,3).some(i=>i.uuid===p.equipment[k]?.uuid));
    if(slot)await r.shopService.equipItem(r.id,c.uuid,slot);
  }
  const after=gearView(p);
  if(JSON.stringify(after)!==JSON.stringify(before))r.log('equip',{before,after});
  for(const i of [...p.inventory]) {
    if(i.itemType==='equipment'&&!/^special/.test(i.equipSlot||'')&&!['job_eq','title_eq','anchor'].includes(i.equipSlot)&&i.tier) {
      const keep=i.equipSlot==='weapon'&&wanted.includes(i.weaponType)&&!wanted.includes(p.equipment.weapon?.weaponType);
      if(keep)continue;
      const out=await r.shopService.discardItem(r.id,i.uuid,{mode:'dismantle'});r.log('dismantle',{id:i.itemId,...out});
    }else if(![...Object.values(ENHANCE_GEMS)].includes(i.itemId)&&!i.itemId?.startsWith('element-stone-')&&i.itemType!=='job_badge'&&!['title_eq','anchor','job_eq'].includes(i.equipSlot)) {
      try{const quote=await r.shopService.getSellQuote(r.id,i.uuid,i.stackCount||1);if(quote.totalGold>0){await r.shopService.sellItemBulk(r.id,i.uuid,i.stackCount||1);r.log('sell',{id:i.itemId,quote});}}catch(e){if(!['INVALID_ARGUMENT','ITEM_NOT_FOUND'].includes(e.code))throw e;}
    }
  }
}
async function enhance(r) {
  const p=r.progress;
  for(let round=0;round<3;round++)for(const slot of ['weapon','armor','shield','garment','shoes','head_top','head_mid','head_low','accessory_l','accessory_r']) {
    const i=p.equipment[slot];if(!i||!i.tier||(i.enhanceLevel||0)>=3)continue;
    const cost=getEnhanceCost(i.tier,i.enhanceLevel||0),gem=p.inventory.find(e=>e.itemId===ENHANCE_GEMS[i.tier]);
    const reserve=p.level>=30&&!ja.getT2Branch(p.equipment.job_eq?.itemId)?250000:0;
    if(!cost.gemsRequired||!(gem?.stackCount>=cost.gemsRequired)||r.wallet.gold-reserve<cost.goldRequired)continue;
    const out=await r.enhanceService.enhanceEquipment(r.id,i.uuid);r.log('enhance',{slot,id:i.itemId,success:out.success,plus:i.enhanceLevel,cost});
  }
}
async function buyStarter(r) {
  if(r.route.weaponTypes.includes(r.progress.equipment.weapon?.weaponType))return;
  const shop=r.shopItems.filter(i=>i.enabled&&r.route.weaponTypes.includes(i.weaponType)&&i.currency==='gold').sort((a,b)=>a.price-b.price)[0];
  if(shop&&r.wallet.gold>=shop.price){const out=await r.shopService.purchase(r.id,'isolated',shop.id);r.purchases.push(shop.id);r.log('buy',{id:shop.id,name:shop.name,price:shop.price});}
}
async function claimAvailable(r) {
  const rows=await r.questService.getPlayerProgress(r.id,'all');
  for(const row of rows){const q=row.quest;
    if(row.claimed||row.locked||!q?.enabled)continue;
    if(q.cadence==='job'&&![r.route.t1Quest,r.route.t2Quest].includes(q.id))continue;
    if(!row.done)continue;
    const before=r.progress.equipment.job_eq;
    const result=await r.claim(q);
    if(q.id===r.route.t1Quest){const badge=r.progress.inventory.find(i=>i.itemId===r.route.t1Badge);await r.shopService.equipItem(r.id,badge.uuid,'job_eq');r.log('t1',{level:r.progress.level,badge:r.route.t1Badge,gear:gearView(r.progress)});}
    if(result.jobTransfer)r.log('t2',{level:r.progress.level,before:before?.itemId,badge:r.progress.equipment.job_eq?.itemId,cost:result.jobTransfer.cost,jobExp:r.progress.equipment.job_eq?.jobExp,gear:gearView(r.progress)});
  }
}
module.exports={matrix,gearView,equipAndRecycle,enhance,buyStarter,claimAvailable,score,cardScore,isAcquired};
