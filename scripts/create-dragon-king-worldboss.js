"use strict";
/**
 * 建立第二隻世界王「龍王(B)」— 終局難度，位於新 zone 龍王巢穴(dragon_king_lair)
 *
 *  - monsters：龍王(B) boss 怪（HP 240 萬、Lv65、比大史王強）
 *  - items：龍王卡（A 階怪物卡，特殊槽，雷霆龍焰技能）
 *  - worldBossConfig：_id="dragon_king"（value 結構，三階段強化）
 *  - worldBossState：_id="dragon_king" 初始狀態
 *
 * 解鎖：需先擊敗本週大史王（由 worldBossService 的 unlockRequiresBossKey 控制，非本腳本）
 * 可重複執行（先刪同 id 再建）。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const NOW = new Date().toISOString();
const BOSS_ID = "dragon-king-boss";
const CARD_ID = "monster-card-dragon-king";
const ZONE = "dragon_king_lair";

const BOSS_HP = 2655000;     // 終局：強化後大史王(177萬) 的 1.5 倍（原始大史王 2.25×）

// 龍焰：命中時造成自身攻擊力 200% 的雷焰額外傷害
const lightningProc = {
  key: "lightning",
  target: "enemy",
  trigger: "on_hit",
  chance: 100,
  sourcePhase: "proc",
  params: { value: 200, duration: { mode: "turns", value: 1 }, mode: "caster_atk_pct" },
};
// 破鱗：命中時使敵方防禦 -30%，持續 2 回合
const defBreakProc = {
  key: "def_down",
  target: "enemy",
  trigger: "on_hit",
  chance: 100,
  sourcePhase: "proc",
  params: { value: 30, duration: { mode: "turns", value: 2 } },
};
const cardProcs = [lightningProc, defBreakProc];
const cardSkill = {
  key: "dragon_king_breath",
  name: "龍王・逆鱗焚天",
  description: "50% 機率噴吐龍焰，造成自身攻擊力 200% 的雷焰傷害，並破鱗使敵方防禦 -30%（2 回合）。",
  chance: 50,
  cooldownTurns: 0,
  trigger: "on_hit",
  procEffects: cardProcs,
};

const dragonKingCard = {
  id: CARD_ID,
  seq: 0,
  name: "龍王卡",
  itemType: "equipment",
  equipSlot: "special",
  tier: "A",
  itemEffect: { type: "none", value: 0 },
  useEffects: [],
  passiveEffects: [],
  procEffects: cardProcs,
  combatEffects: [],
  equipStats: { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 },
  weaponType: null,
  isTwoHanded: false,
  atkStat: null,
  imageUrl: null,
  imageThumbnailUrl: null,
  monsterCardSkill: cardSkill,
  monsterCardOf: BOSS_ID,
  description: "龍王・逆鱗焚天：50% 機率造成自身攻擊力 200% 雷焰傷害，並使敵方防禦 -30%（2 回合）。",
  createdAt: NOW,
  updatedAt: NOW,
};

const dragonKingMonster = {
  id: BOSS_ID,
  seq: 1,
  name: "龍王(B)",
  zone: ZONE,
  level: 70,
  maxHp: BOSS_HP,                              // 強化後大史王(177萬) 的 1.5×（原始 2.25×）
  // 強化後大史王的 1.5×（= 原始大史王 2.25×）
  str: 101, agi: 79, vit: 124, int: 74, dex: 101, luk: 68,
  def: 158,
  defIgnorePct: 70,                            // 與大史王相同（% 值不倍增）
  expReward: 30000,
  goldReward: 60000,
  entryFee: 0,
  isBoss: true,
  enabled: true,
  spawnRate: 100,
  imageUrl: null,
  imageThumbnailUrl: null,
  monsterCardSkill: cardSkill,
  equipment: {
    special_1: {
      itemId: CARD_ID,
      itemName: "龍王卡",
      itemType: "equipment",
      itemEffect: { type: "none", value: 0 },
      useEffects: [],
      passiveEffects: [],
      procEffects: cardProcs,
      combatEffects: [],
      equipSlot: "special",
      equipStats: { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 },
      weaponType: null,
      isTwoHanded: false,
      atkStat: null,
      tier: "A",
      monsterCardSkill: cardSkill,
      monsterCardOf: BOSS_ID,
      imageUrl: null,
      imageThumbnailUrl: null,
    },
  },
  dropTheme: { key: "dragon_king", tags: ["dragon", "weapon", "armor", "accessory"], note: "龍王偏 A 階武器/防具/對戒" },
  createdAt: NOW,
  updatedAt: NOW,
};

const dragonKingConfig = {
  enabled: true,
  targetZone: "dragon_realm",         // 困難區擊殺追蹤（解鎖實際由「先電大史王」控制）
  weeklyUnlockKillTarget: 0,
  battleTimeLimitMinutes: 30,
  respawnCooldownMinutes: 60,
  eliteZoneKey: ZONE,
  phaseConfig: [
    { phase: 1, hpBelowPercent: 70, atkMultiplier: 1.0, defMultiplier: 1.0, agiBonus: 0,  note: "第一階段" },
    { phase: 2, hpBelowPercent: 40, atkMultiplier: 1.3, defMultiplier: 1.15, agiBonus: 0, note: "第二階段（逆鱗）" },
    { phase: 3, hpBelowPercent: 0,  atkMultiplier: 1.6, defMultiplier: 1.3, agiBonus: 45, note: "第三階段（龍王之怒）" },
  ],
};

const dragonKingState = {
  weekKey: null,           // 由 service 依當週重置
  hardKills: 0,
  unlockedAt: null,
  lastKilledAt: null,
  battleStartedAt: null,
  lastFailedAt: null,
};

async function main() {
  const db = await getMongoDb();

  // 怪物
  await db.collection("monsters").deleteMany({ id: BOSS_ID });
  await db.collection("monsters").insertOne(dragonKingMonster);
  console.log(`[OK] 建立怪物：龍王(B) Lv${dragonKingMonster.level} HP ${BOSS_HP.toLocaleString()}（強化後大史王 1.5× / 原始 2.25×）@ ${ZONE}`);

  // 龍王卡
  await db.collection("items").deleteMany({ id: CARD_ID });
  await db.collection("items").insertOne(dragonKingCard);
  console.log(`[OK] 建立道具：龍王卡 (${CARD_ID})`);

  // worldBossConfig (dragon_king)
  await db.collection("worldBossConfig").updateOne(
    { _id: "dragon_king" },
    { $set: { value: dragonKingConfig, updatedAt: NOW }, $setOnInsert: { createdAt: NOW } },
    { upsert: true }
  );
  console.log(`[OK] 寫入 worldBossConfig: dragon_king（戰鬥 30 分、冷卻 60 分、三階段）`);

  // worldBossState (dragon_king)
  await db.collection("worldBossState").updateOne(
    { _id: "dragon_king" },
    { $set: { value: dragonKingState, updatedAt: NOW }, $setOnInsert: { createdAt: NOW } },
    { upsert: true }
  );
  console.log(`[OK] 寫入 worldBossState: dragon_king（初始）`);

  console.log("\n完成。龍王(B) 已建立於『龍王巢穴』，需先擊敗本週大史王才解鎖。");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
