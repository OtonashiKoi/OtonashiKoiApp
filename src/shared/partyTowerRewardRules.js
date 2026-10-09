"use strict";
const { ENHANCE_GEMS } = require("./enhanceConfig");
const WEAPON_SETS = ["mithril_p", "mithril_m", "dragonscale_p", "dragonscale_m", "hellfire_p", "hellfire_m", "magnetic_p", "magnetic_m"];
const REWARDS = Object.freeze({
  normal: { floors: 30, minLevel: 30, metric: "party_tower_normal_clear", boxId: "chest-party-tower-a-choice", tier: "A", aMin: 3, aMax: 5, s: 0 },
  challenge: { floors: 50, minLevel: 40, metric: "party_tower_challenge_clear", boxId: "chest-party-tower-s-choice", tier: "S", aMin: 4, aMax: 6, s: 1 },
});
function checkpoint(difficulty, floor, random = Math.random) {
  const rule = REWARDS[difficulty];
  if (!rule || !Number.isInteger(floor) || floor < 1 || floor > rule.floors || floor % 5) return [];
  return [{ itemId: ENHANCE_GEMS.A, qty: rule.aMin + Math.min(rule.aMax - rule.aMin, Math.floor(random() * (rule.aMax - rule.aMin + 1))) },
    ...(rule.s ? [{ itemId: ENHANCE_GEMS.S, qty: rule.s }] : [])];
}
function boxes(image = {}) {
  return Object.values(REWARDS).map(r => ({ id: r.boxId, name: `${r.tier}級武器自選箱`, tier: r.tier, itemType: "consumable",
    description: `本季首次完整通關${r.floors}樓組隊爬塔的任務獎勵。使用後自選1把${r.tier}級主手武器（秘銀、龍鱗、火焰、磁鋼系列），不含活動限定武器。`,
    effect: { type: "open_weapon_choice", tier: r.tier, setKeys: WEAPON_SETS },
    imageUrl: image.imageUrl || null, imageThumbnailUrl: image.imageThumbnailUrl || null,
    equipSlot: null, equipStats: {}, useEffects: [], passiveEffects: [], procEffects: [], combatEffects: [],
  }));
}
function quests() {
  return Object.entries(REWARDS).map(([difficulty, r], i) => ({
    id: `autumn-202610-season-${r.metric}`, cadence: "season", type: r.metric, target: 1,
    title: `本季首登・${difficulty === "normal" ? "一般30樓" : "挑戰50樓"}`,
    description: `本季首次完整通關${difficulty === "normal" ? "一般" : "挑戰"}組隊爬塔${r.floors}樓，在此領取${r.tier}級武器自選箱×1。帳號本季限領一次，換人物與再次通關不重複領取。`,
    enabled: true, groupKey: "autumn_202610_v1", resetPolicy: "once", claimOnce: true, hideIfRewardOwned: false,
    unlockLevel: r.minLevel, levelLimit: 0, rewardGold: 0, rewardExp: 0, rewardDiamond: 0,
    rewardItemId: null, rewardItems: [{ itemId: r.boxId, qty: 1 }], sortOrder: 230 + i * 10,
  }));
}
module.exports = { REWARDS, WEAPON_SETS, checkpoint, boxes, quests };
