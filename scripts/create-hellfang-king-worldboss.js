"use strict";
/**
 * 將「地獄狼牙王」升格為第三隻世界王 — 新終局，位於新 zone 焰獄深處(hellfire_depths)
 * 強度略高於古龍王(古龍王 HP 265萬)。
 *
 *  - monsters：地獄狼牙王（沿用既有 id 0393acee…，保留圖片）搬到 hellfire_depths / seq1，
 *              數值強化(L65 / HP 320萬 / 破防70%)，掛上狼牙王卡，drops 指向狼牙王卡。
 *  - items：狼牙王卡（A 階怪物卡，特殊槽，煉獄咬噬技能）
 *  - items：地獄狼牙王寶箱（open_world_boss_chest）
 *  - worldBossConfig：_id="hellfang_king"（三階段強化）
 *  - worldBossState：_id="hellfang_king" 初始狀態
 *
 * 解鎖：需先擊敗本週古龍王（由 worldBossService unlockRequiresBossKey="dragon_king" 控制，非本腳本）
 * 可重複執行（怪物用 $set 保留圖片；卡片/寶箱/config/state 用 upsert）。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const NOW = new Date().toISOString();
const BOSS_ID = "0393acee-9851-4bcb-a8f5-fdb60a9968f1"; // 既有地獄狼牙王，沿用以保留圖片與參照
const CARD_ID = "monster-card-hellfang-king";
const CHEST_ID = "chest-hellfang-king";
const ZONE = "hellfire_depths";

const BOSS_HP = 3200000; // 古龍王 265萬 的 ~1.2×（新終局）

// 煉獄咬噬：命中時造成自身攻擊力 220% 的灼燒傷害（單次即時；1 回合=即時）
const burnProc = {
  key: "burn",
  target: "enemy",
  trigger: "on_hit",
  chance: 100,
  sourcePhase: "proc",
  params: { value: 220, duration: { mode: "turns", value: 1 }, mode: "caster_atk_pct" },
};
// 撕裂：命中時使敵方防禦 -35%，持續 2 回合（略強於龍王的 -30%）
const defBreakProc = {
  key: "def_down",
  target: "enemy",
  trigger: "on_hit",
  chance: 100,
  sourcePhase: "proc",
  params: { value: 35, duration: { mode: "turns", value: 2 } },
};
const cardProcs = [burnProc, defBreakProc];
const cardSkill = {
  key: "hellfang_inferno_bite",
  name: "狼牙王・煉獄咬噬",
  description: "50% 機率施放煉獄咬噬，造成自身攻擊力 220% 的灼燒傷害，並撕裂使敵方防禦 -35%（2 回合）。",
  chance: 50,
  cooldownTurns: 0,
  trigger: "on_hit",
  procEffects: cardProcs,
};

const hellfangCard = {
  id: CARD_ID,
  seq: 0,
  name: "狼牙王卡",
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
  description: "狼牙王・煉獄咬噬：50% 機率造成自身攻擊力 220% 灼燒傷害，並使敵方防禦 -35%（2 回合）。",
  createdAt: NOW,
  updatedAt: NOW,
};

// 掛在 boss 身上的特殊槽裝備（結構比照龍王(B)）
const bossEquipment = {
  special_1: {
    itemId: CARD_ID,
    itemName: "狼牙王卡",
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
};

// 只 $set 需要改的欄位，保留既有 imageUrl / imageThumbnailUrl
const bossSet = {
  seq: 1,
  zone: ZONE,
  level: 65,
  maxHp: BOSS_HP,
  str: 115, agi: 55, vit: 140, int: 40, dex: 60, luk: 35,
  def: 70,
  defIgnorePct: 70,          // 與古龍王同（% 值不倍增）
  expReward: 30000,
  goldReward: 60000,
  entryFee: 0,               // 0 → 沿用 zone 預設進場費(15000)
  isBoss: true,
  enabled: true,
  spawnRate: 100,
  monsterCardSkill: cardSkill,
  equipment: bossEquipment,
  drops: [{ itemId: CARD_ID, chance: 100 }],
  dropTheme: { key: "hellfang_king", tags: ["fire", "weapon", "armor", "accessory"], note: "地獄狼牙王偏 A 階火焰武器/防具/對戒" },
  updatedAt: NOW,
};

const chestDoc = {
  id: CHEST_ID,
  name: "地獄狼牙王寶箱",
  description: "開啟後，依地獄狼牙王的掉落比重隨機獲得一份其掉落物。",
  itemType: "consumable",
  effect: { type: "open_world_boss_chest", monsterId: BOSS_ID, bossName: "地獄狼牙王" },
  imageUrl: null,
  imageThumbnailUrl: null,
  updatedAt: NOW,
  createdAt: NOW,
};

const hellfangConfig = {
  enabled: true,
  targetZone: "hellfire",              // 困難區擊殺追蹤（解鎖實際由「先電古龍王」控制）
  weeklyUnlockKillTarget: 0,
  battleTimeLimitMinutes: 30,
  respawnCooldownMinutes: 60,
  eliteZoneKey: ZONE,
  phaseConfig: [
    { phase: 1, hpBelowPercent: 70, atkMultiplier: 1.0,  defMultiplier: 1.0,  agiBonus: 0,  lightningEnabled: false, note: "第一階段" },
    { phase: 2, hpBelowPercent: 40, atkMultiplier: 1.35, defMultiplier: 1.15, agiBonus: 0,  lightningEnabled: false, note: "第二階段（狂焰）" },
    { phase: 3, hpBelowPercent: 0,  atkMultiplier: 1.75, defMultiplier: 1.3,  agiBonus: 50, lightningEnabled: false, note: "第三階段（煉獄咆哮）" },
  ],
};

const hellfangState = {
  weekKey: null,
  hardKills: 0,
  unlockedAt: null,
  lastKilledAt: null,
  battleStartedAt: null,
  lastFailedAt: null,
};

async function main() {
  const db = await getMongoDb();

  const before = await db.collection("monsters").findOne({ id: BOSS_ID }, { projection: { zone: 1, seq: 1, imageUrl: 1 } });
  if (!before) throw new Error(`找不到地獄狼牙王 (${BOSS_ID})，請先確認怪物存在`);

  // 怪物：搬到焰獄深處 + 強化 + 掛卡（$set 保留圖片）
  await db.collection("monsters").updateOne({ id: BOSS_ID }, { $set: bossSet });
  console.log(`[OK] 地獄狼牙王 ${before.zone}/seq${before.seq} → ${ZONE}/seq1，L65 HP ${BOSS_HP.toLocaleString()}（圖片保留：${before.imageUrl ? "是" : "無"}）`);

  // 狼牙王卡
  await db.collection("items").updateOne({ id: CARD_ID }, { $set: hellfangCard, $setOnInsert: {} }, { upsert: true });
  console.log(`[OK] 狼牙王卡 (${CARD_ID})`);

  // 寶箱
  const chestExisting = await db.collection("items").findOne({ id: CHEST_ID }, { projection: { imageUrl: 1, createdAt: 1 } });
  await db.collection("items").updateOne(
    { id: CHEST_ID },
    { $set: { ...chestDoc, imageUrl: chestExisting?.imageUrl || null, createdAt: chestExisting?.createdAt || NOW } },
    { upsert: true }
  );
  console.log(`[OK] 地獄狼牙王寶箱 (${CHEST_ID})`);

  // worldBossConfig / State
  await db.collection("worldBossConfig").updateOne(
    { _id: "hellfang_king" },
    { $set: { value: hellfangConfig, updatedAt: NOW }, $setOnInsert: { createdAt: NOW } },
    { upsert: true }
  );
  console.log(`[OK] worldBossConfig: hellfang_king（戰鬥 30 分、冷卻 60 分、三階段）`);

  await db.collection("worldBossState").updateOne(
    { _id: "hellfang_king" },
    { $set: { value: hellfangState, updatedAt: NOW }, $setOnInsert: { createdAt: NOW } },
    { upsert: true }
  );
  console.log(`[OK] worldBossState: hellfang_king（初始）`);

  console.log("\n完成。地獄狼牙王已升格世界王，位於『焰獄深處』，需先擊敗本週古龍王才解鎖。");
  console.log("提醒：後端程式(worldBossService / createServiceContext)改動需重啟才生效。");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
