'use strict';
const {withPlayerProgressLock}=require('../progress/progressLocks');
const {pushRewardItemsToInventory}=require('../../shared/jobBadgeBonus');
const {CURRENCY_SOURCES}=require('../../shared/sources');
async function grantAutumnQuestReward(sc,discordId,displayName,reward){
 const ref=reward.receipt;
 if(!ref||reward.exp||reward.rewardItemId)throw Error('秋季任務獎勵格式無效');
 if(reward.gold>0)await sc.rewardService.grantCurrency({discordId,displayName,currencyType:'gold',amount:reward.gold,source:CURRENCY_SOURCES.QUEST_REWARD,sourceRef:ref+':gold',operator:'quest'});
 if(reward.rewardItems?.length)await withPlayerProgressLock(discordId,async()=>{
  for(let retry=0;retry<8;retry++){
   const p=await sc.progressRepository.findByPlayerId(discordId);if(!p)throw Error('找不到人物');
   if((p.questRewardReceipts||[]).includes(ref))return;
   // MongoDB owns _id; cloning ObjectId changes its BSON type and breaks CAS updates.
   const { _id, ...mutable }=p;
   const next=structuredClone(mutable);
   for(const item of reward.rewardItems)if(!await sc.itemRepository.findById(item.itemId))throw Error('任務獎勵道具不存在');
   const granted=await pushRewardItemsToInventory({progress:next,itemRepository:sc.itemRepository,rewardItems:reward.rewardItems,source:'quest'});
   next.questRewardReceipts=[...(p.questRewardReceipts||[]),ref];next.updatedAt=new Date(Math.max(Date.now(),(Date.parse(p.updatedAt)||0)+1)).toISOString();
   if(await sc.progressRepository.saveIfUnchanged(next,p.updatedAt)){reward.rewardItemsGranted=granted;return;}
  }
  throw Error('任務背包儲存忙碌，請重試');
 });
}
module.exports={grantAutumnQuestReward};
