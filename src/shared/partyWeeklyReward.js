'use strict';
const { ENHANCE_GEMS } = require('./enhanceConfig');
const QUEST_ID = 'autumn-202610-weekly-party_floor_clear';
const TITLE_ID = 'title-party-tower-together-v1';
const questPatch = {
  title: '組隊探索', target: 20, unlockLevel: 30, rewardGold: 12000,
  description: '每週累積通關組隊副本 20 樓（一般、挑戰皆可，不需整塔通關）。獎勵：12,000 金幣、B 階寶石 ×5、A 階寶石 ×2；帳號首次領取另獲永久稱號「同心登塔」。',
  rewardItems: [{ itemId: ENHANCE_GEMS.B, qty: 5 }, { itemId: ENHANCE_GEMS.A, qty: 2 },
    { itemId: TITLE_ID, qty: 1, oncePerAccount: true }],
};
const titleItem = {
  id: TITLE_ID, name: '同心登塔', description: '首次完成並領取「組隊探索」週任務的紀念稱號。帳號限領一次，永久保留，無額外能力加成。',
  itemType: 'equipment', equipSlot: 'title_eq', tier: null, seasonPersistent: true,
  effect: { type: 'none', value: 0 }, equipStats: {}, useEffects: [], procEffects: [], combatEffects: [], passiveEffects: [],
  imageUrl: 'https://otonashikoi.org/uploads/items/autumn-titles/companions.png',
  imageThumbnailUrl: 'https://otonashikoi.org/uploads/items/autumn-titles/companions.png',
};
module.exports = { QUEST_ID, TITLE_ID, questPatch, titleItem };
