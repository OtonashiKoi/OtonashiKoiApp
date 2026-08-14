"use strict";

/**
 * 北風雀神・胡桃：音無恋私測世界王＋13 種 S 階限定武器。
 *
 * 預設只列出將要寫入的內容；加 --apply 才會更新 MongoDB。
 * 本腳本只管理 northwind_hutao / event_boss_hutao_preview，絕不修改島島龜王。
 *
 * 用法：
 *   node scripts/upsert-event-hutao-preview.js
 *   node scripts/upsert-event-hutao-preview.js --apply
 */

require("dotenv").config();
const { getMongoDb, closeMongoClient } = require("../src/adapters/mongo/createMongoClient");

const APPLY = process.argv.includes("--apply");
const BOSS_KEY = "northwind_hutao";
const ZONE = "event_boss_hutao_preview";
const MONSTER_ID = "event-northwind-hutao";
const CARD_ID = "monster-card-northwind-hutao";
const IMAGE_URL = "/uploads/monsters/northwind-hutao-v1.png";
const WIND_EFFECT_KEY = "wind_direction_cycle";
const PREVIEW_BOSS_HP = 100000;
const FORMAL_RELEASE_TARGET_HP = 4500000;
const DROP_CHANCE = Math.round((100 / 13) * 100) / 100;
const S = (str = 0, agi = 0, vit = 0, int = 0, dex = 0, luk = 0) => ({ str, agi, vit, int, dex, luk });

const WIND_EFFECT = Object.freeze({
  key: WIND_EFFECT_KEY,
  target: "self",
  trigger: "passive",
  chance: 100,
  sourcePhase: "passive",
  params: {
    eastHit: 10,
    southFinalDamagePct: 8,
    westCritDamagePct: 20,
    northCritRatePct: 15,
  },
  notes: "風向輪轉：每回合依序切換東風命中+10／南風最終傷害+8%／西風爆擊傷害+20%／北風爆擊率+15%；戰鬥結束後從下一風向繼續。",
});

const WEAPONS = Object.freeze([
  { id: "hutao-wind-sword-1h", name: "東風・青龍雀劍", slot: "weapon", type: "sword_1h", twoH: false, atk: "str", stats: S(14, 3, 0, 0, 0, 2), desc: "青翠劍光隨東風先行，出鞘時能聽見牌河翻動。" },
  { id: "hutao-wind-sword-2h", name: "四喜・北天巨劍", slot: "weapon", type: "sword_2h", twoH: true, atk: "str", stats: S(18, 3, 4, 0, 0, 0), desc: "劍脊刻著東南西北，四風齊聚時重若天門。" },
  { id: "hutao-wind-axe-1h", name: "斷么・翠嵐手斧", slot: "weapon", type: "axe_1h", twoH: false, atk: "str", stats: S(13, 0, 2, 0, 0, 4), desc: "斧鋒俐落得不留么九，只留下被風切開的缺口。" },
  { id: "hutao-wind-axe-2h", name: "嶺上・裂空巨斧", slot: "weapon", type: "axe_2h", twoH: true, atk: "str", stats: S(18, 0, 3, 0, 0, 4), desc: "自嶺上補來的一擊，連北風都被劈成兩道。" },
  { id: "hutao-wind-dagger", name: "搶槓・燕返匕首", slot: "weapon", type: "dagger", twoH: false, atk: "agi", stats: S(4, 11, 0, 0, 0, 4), desc: "在牌落桌前便已奪走勝機，快得只剩一縷風痕。" },
  { id: "hutao-wind-dice", name: "自摸・四風骰", slot: "weapon", type: "dice", twoH: true, atk: "luk", stats: S(0, 4, 0, 0, 4, 15), desc: "六面刻著牌局的風，擲出的點數總像早已寫好。" },
  { id: "hutao-wind-mace-1h", name: "一發・雀音戰錘", slot: "weapon", type: "mace_1h", twoH: false, atk: "str", stats: S(12, 0, 5, 0, 2, 0), desc: "立直後的一發重響，像整張雀桌同時震了一下。" },
  { id: "hutao-wind-mace-2h", name: "海底・北冥巨槌", slot: "weapon", type: "mace_2h", twoH: true, atk: "str", stats: S(17, 3, 5, 0, 0, 0), desc: "牌山將盡時落下的最後重擊，沉得像北海深處。" },
  { id: "hutao-wind-staff-1h", name: "東場・青龍法杖", slot: "weapon", type: "staff_1h", twoH: false, atk: "int", stats: S(0, 0, 4, 11, 4, 0), desc: "杖端盤著青龍之風，東場開局便喚醒木行靈氣。" },
  { id: "hutao-wind-staff-2h", name: "北場・雀神長杖", slot: "weapon", type: "staff_2h", twoH: true, atk: "int", stats: S(0, 0, 4, 15, 4, 0), desc: "北風本命全開時，杖上四枚風牌會一同亮起。" },
  { id: "hutao-wind-bow", name: "立直・破風長弓", slot: "weapon", type: "bow", twoH: true, atk: "dex", stats: S(0, 5, 0, 0, 15, 3), desc: "弦聲就是立直宣言，箭離弦後才聽見風被洞穿。" },
  { id: "hutao-wind-offhand-sword", name: "對子・雙風脇差", slot: "shield", type: "offhand_sword", twoH: false, atk: "str", stats: S(6, 3, 3, 0, 0, 0), desc: "與主手相應成對，兩道風痕如同牌中的對子。" },
  { id: "hutao-wind-offhand-dagger", name: "暗刻・羽切短刃", slot: "shield", type: "offhand_dagger", twoH: false, atk: "agi", stats: S(0, 7, 0, 0, 2, 3), desc: "三枚暗藏的刃影無聲聚合，直到命中才被看見。" },
]);

function buildCard(now) {
  const monsterCardSkill = {
    key: "hutao_four_winds",
    name: "東南西北",
    description: "攻擊命中時有 12% 機率召出東南西北四方風刃，各造成該次傷害 45%。",
    chance: 12,
    cooldownTurns: 0,
    trigger: "on_hit",
    procEffects: [{
      key: "proc_chain_hit",
      target: "enemy",
      trigger: "on_hit",
      chance: 100,
      sourcePhase: "proc",
      params: { chainCount: 4, damageMultiplier: 0.45 },
    }],
  };
  return {
    id: CARD_ID,
    name: "北風雀神・胡桃卡",
    description: monsterCardSkill.description,
    itemType: "equipment",
    tier: "S",
    equipSlot: "special",
    equipStats: S(),
    effect: { type: "none", value: 0 },
    enhanceLevel: 0,
    useEffects: [],
    passiveEffects: [],
    procEffects: [],
    combatEffects: [],
    monsterCardSkill,
    monsterCardOf: MONSTER_ID,
    eventBossKey: BOSS_KEY,
    limitedEvent: true,
    imageUrl: IMAGE_URL,
    imageThumbnailUrl: IMAGE_URL,
    updatedAt: now,
  };
}

function buildItem(spec, now) {
  return {
    id: spec.id,
    name: spec.name,
    description: `${spec.desc}\n【胡桃限定・風向】東風命中 +10／南風最終傷害 +8%／西風爆擊傷害 +20%／北風爆擊率 +15%。風向每回合輪轉，戰鬥結束後不重置。`,
    itemType: "equipment",
    tier: "S",
    equipSlot: spec.slot,
    equipStats: spec.stats,
    weaponType: spec.type,
    isTwoHanded: spec.twoH,
    atkStat: spec.atk,
    effect: { type: "none", value: 0 },
    enhanceLevel: 0,
    useEffects: [],
    passiveEffects: [{ ...WIND_EFFECT, params: { ...WIND_EFFECT.params } }],
    procEffects: [],
    combatEffects: [],
    setKey: null,
    setKeys: [],
    setName: null,
    dropTheme: "event_hutao_northwind",
    elementDrop: { element: "wood", chancePct: 100, minLevel: 3, maxLevel: 4 },
    eventBossKey: BOSS_KEY,
    limitedEvent: true,
    updatedAt: now,
  };
}

function buildMonster(now, card) {
  return {
    id: MONSTER_ID,
    seq: 1,
    name: "北風雀神・胡桃",
    zone: ZONE,
    level: 65,
    // 音無恋單人私測使用低血量；正式全服開放時預計調為 FORMAL_RELEASE_TARGET_HP。
    maxHp: PREVIEW_BOSS_HP,
    str: 85,
    agi: 90,
    vit: 80,
    int: 70,
    dex: 85,
    luk: 70,
    def: 50,
    flatDef: 145,
    defIgnorePct: 15,
    element: "wood",
    elementLevel: 4,
    expReward: 3500,
    goldReward: 12000,
    entryFee: 5000,
    isBoss: true,
    enabled: true,
    spawnRate: 100,
    dropTheme: "event_hutao_northwind",
    drops: [
      ...WEAPONS.map((w) => ({ itemId: w.id, itemName: w.name, chance: DROP_CHANCE })),
      { itemId: CARD_ID, itemName: card.name, chance: 1 },
    ],
    equipment: { special_1: card },
    passiveEffects: [],
    procEffects: [],
    battleStartEffects: [],
    skills: [],
    previewOnly: true,
    previewPlayerIds: ["865264891991425055"],
    imageUrl: IMAGE_URL,
    imageThumbnailUrl: IMAGE_URL,
    updatedAt: now,
  };
}

async function main() {
  const now = new Date().toISOString();
  const card = buildCard(now);
  const items = [...WEAPONS.map((spec) => buildItem(spec, now)), card];
  const monster = buildMonster(now, card);

  console.log(
    `北風雀神・胡桃私測：HP ${PREVIEW_BOSS_HP.toLocaleString()}（正式目標 ${FORMAL_RELEASE_TARGET_HP.toLocaleString()}）` +
    `，${WEAPONS.length} 種武器＋1 張王卡，每件武器掉落率 ${DROP_CHANCE}%`
  );
  for (const item of items.filter((entry) => entry.weaponType)) {
    const sum = Object.values(item.equipStats).reduce((total, value) => total + Number(value || 0), 0);
    console.log(`- ${item.name} | ${item.weaponType} | ${item.equipSlot} | 屬性總和 ${sum}`);
  }
  if (!APPLY) {
    console.log("試跑完成；未寫入 MongoDB。加 --apply 才會套用。");
    return;
  }

  const db = await getMongoDb();
  for (const item of items) {
    await db.collection("items").updateOne(
      { id: item.id },
      {
        $set: item,
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );
  }

  await db.collection("monsters").updateOne(
    { id: MONSTER_ID },
    {
      $set: monster,
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  const config = {
    enabled: true,
    targetZone: ZONE,
    weeklyUnlockKillTarget: 1,
    battleTimeLimitMinutes: 120,
    respawnCooldownMinutes: 120,
    eliteZoneKey: ZONE,
    phaseConfig: [
      { phase: 1, hpBelowPercent: 70, atkMultiplier: 1.0, defMultiplier: 1.0, agiBonus: 0, note: "東風巡場" },
      { phase: 2, hpBelowPercent: 40, atkMultiplier: 1.15, defMultiplier: 1.0, agiBonus: 0, note: "南西風交替" },
      { phase: 3, hpBelowPercent: 0, atkMultiplier: 1.3, defMultiplier: 1.0, agiBonus: 0, note: "北風本命" },
    ],
  };
  await db.collection("worldBossConfig").updateOne(
    { _id: BOSS_KEY },
    { $set: { value: config, updatedAt: now } },
    { upsert: true }
  );
  await db.collection("worldBossState").updateOne(
    { _id: BOSS_KEY },
    {
      $setOnInsert: {
        value: { weekKey: null, hardKills: 0, unlockedAt: null, lastKilledAt: null, battleStartedAt: null, lastFailedAt: null },
        createdAt: now,
      },
      $set: { updatedAt: now },
    },
    { upsert: true }
  );

  console.log("已寫入 13 種胡桃限定武器、胡桃王卡、完整私測王、獨立世界王設定與狀態。");
  console.log("島島龜王與 event_boss 未修改。");
  await closeMongoClient();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  return closeMongoClient().catch(() => {});
});
