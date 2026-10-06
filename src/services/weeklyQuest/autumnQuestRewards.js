'use strict';
const {withPlayerProgressLock}=require('../progress/progressLocks');
const {pushRewardItemsToInventory}=require('../../shared/jobBadgeBonus');
const {CURRENCY_SOURCES}=require('../../shared/sources');
const {isUnavailableEquipment}=require('../../shared/equipmentAvailability');
function ownsItem(p,id){
 return (p.inventory||[]).some(i=>i.itemId===id)||[p,...Object.values(p.characterSlots||{})].some(c=>Object.values(c?.equipment||{}).some(i=>i?.itemId===id));
}
async function grantAutumnQuestReward(sc,discordId,displayName,reward){
 const ref=reward.receipt;
 if(!ref||reward.exp||reward.rewardItemId)throw Error('秋季任務獎勵格式無效');
 const definitions=new Map();
 for(const spec of reward.rewardItems||[]){
  const item=await sc.itemRepository.findById(spec.itemId);
  if(!item||isUnavailableEquipment(item))throw Error('任務獎勵道具不存在或不可發放');
  if(!Number.isSafeInteger(spec.qty)||spec.qty<1||(spec.oncePerAccount&&(spec.qty!==1||item.equipSlot!=='title_eq')))throw Error('任務獎勵數量或稱號格式無效');
  definitions.set(spec.itemId,item);
 }
 if(reward.gold>0)await sc.rewardService.grantCurrency({discordId,displayName,currencyType:'gold',amount:reward.gold,source:CURRENCY_SOURCES.QUEST_REWARD,sourceRef:ref+':gold',operator:'quest'});
 if(reward.rewardItems?.length)await withPlayerProgressLock(discordId,async()=>{
  for(let retry=0;retry<8;retry++){
   const p=await sc.progressRepository.findByPlayerId(discordId);if(!p)throw Error('找不到人物');
   if((p.questRewardReceipts||[]).includes(ref))return;
   // MongoDB owns _id; cloning ObjectId changes its BSON type and breaks CAS updates.
   const { _id, ...mutable }=p;
   const next=structuredClone(mutable);
   // Lifetime receipts share the inventory CAS, so retries and character switches cannot duplicate titles.
   const once=new Set(p.questOnceItemReceipts||[]);
   const specs=reward.rewardItems.filter(spec=>{
    if(!spec.oncePerAccount)return true;
    const owned=once.has(spec.itemId)||ownsItem(p,spec.itemId);
    once.add(spec.itemId);return !owned;
   });
   const granted=await pushRewardItemsToInventory({progress:next,itemRepository:{findById:async id=>definitions.get(id)},rewardItems:specs,source:'quest'});
   if(reward.rewardItems.some(s=>s.oncePerAccount))next.questOnceItemReceipts=[...once];
   next.questRewardReceipts=[...(p.questRewardReceipts||[]),ref];next.updatedAt=new Date(Math.max(Date.now(),(Date.parse(p.updatedAt)||0)+1)).toISOString();
   if(await sc.progressRepository.saveIfUnchanged(next,p.updatedAt)){reward.rewardItemsGranted=granted;return;}
  }
  throw Error('任務背包儲存忙碌，請重試');
 });
}
module.exports={grantAutumnQuestReward};
