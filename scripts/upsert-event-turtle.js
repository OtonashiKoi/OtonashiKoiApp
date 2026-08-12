"use strict";
// 島島龜王（活動世界王・event_boss 區）＋世界王設定＋島島寶箱。
//
// 機制（使用者定案 2026-07-29，實作在 shared/turtleTide.js＋三入口）：
//   潮汐：漲潮10分（龜首縮殼、其他部位×0.7）/ 退潮5分（全部位×1.5、龜首必中），時間驅動全服同步
//   海嘯詠唱：開戰後每 3 分鐘檢查；總血首次降到 70% / 30% 各固定立刻詠唱一次
//   詠唱 3 分鐘（承傷 1%、冰凍/暈眩累積 ×2）→ 海嘯 3 分鐘（出戰即死・真即死）
//   打斷唯二：巨神震擊 / 區域冰封；打斷或海嘯自然結束 → 破綻 30 秒全員 ×1.3
//   總血條：沉睡(>70% ×1.0) / 甦醒(70~40% ×1.25) / 怒濤(<40% ×1.5)——worldBossConfig phaseConfig
//   部位：龜首25% / 島背40% / 左鰭17.5% / 右鰭17.5%
//
// ⚠️ 本季規矩：enabled:false 建好埋著，使用者說開才開。
require("dotenv").config();
const { MongoClient } = require("mongodb");

const MONSTER_ID = "event-island-turtle";
const ZONE = "event_boss";

async function main() {
  const client = new MongoClient(process.env.MONGO_URI || "mongodb://127.0.0.1:27017");
  await client.connect();
  const db = client.db("equipmentGame");

  // ── 怪物本體 ──
  const monster = {
    id: MONSTER_ID,
    name: "島島龜王",
    zone: ZONE,
    level: 48,
    maxHp: 600000,
    str: 60, agi: 20, vit: 90, int: 30, dex: 55, luk: 40,
    def: 60, defIgnorePct: 0,
    element: "water", elementLevel: 2,
    expReward: 900, goldReward: 2600, entryFee: 3000,
    isBoss: true,
    enabled: false, // ⚠️ 活動開跑前不開
    spawnRate: 100,
    imageUrl: null, imageThumbnailUrl: null, // 圖使用者自己補
    dropTheme: "event_beach",
    drops: [],
    monsterCardSkill: null,
    equipment: {
      special_1: {
        itemId: "monster-card-island-turtle",
        itemName: "島島龜王卡",
        itemType: "equipment",
        itemEffect: { type: "none", value: 0 },
        useEffects: [], passiveEffects: [],
        procEffects: [
          // 椰子雨：搖晃身體，背上的椰子樹一起砸下來
          {
            key: "burn", target: "enemy", trigger: "on_hit", chance: 100, sourcePhase: "proc",
            params: { value: 120, duration: { mode: "turns", value: 1 }, mode: "caster_atk_pct" },
          },
        ],
        combatEffects: [],
        equipSlot: "special",
        equipStats: { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 },
        weaponType: null, isTwoHanded: false, atkStat: null,
        tier: "A",
        monsterCardSkill: {
          key: "turtle_coconut_rain",
          name: "龜王・椰子雨",
          description: "40% 機率搖晃巨軀，背上的椰子如雨落下——造成自身攻擊力 120% 的鈍擊傷害。🥥",
          chance: 40,
        },
      },
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const exist = await db.collection("monsters").findOne({ id: MONSTER_ID });
  if (exist) {
    // 掉落表由 upsert-event-beach-gear.js 維護；重跑龜王本體腳本不可清空寶箱獎池。
    const { createdAt, imageUrl, imageThumbnailUrl, enabled, drops, ...rest } = monster;
    await db.collection("monsters").updateOne({ id: MONSTER_ID }, { $set: { ...rest, updatedAt: new Date().toISOString() } });
    console.log("已更新 島島龜王（enabled/圖片維持現值）");
  } else {
    await db.collection("monsters").insertOne(monster);
    console.log("已新增 島島龜王（enabled:false）");
  }

  // ── 世界王設定（bossKey: island_turtle）──
  // phaseConfig 上限 3 階：沉睡(≥70 ×1.0) / 甦醒(≥40 ×1.25) / 怒濤(<40 ×1.5)
  const cfg = {
    enabled: true, // config 層開著沒關係——怪物本體 enabled:false 才是總開關
    targetZone: "event_1",
    weeklyUnlockKillTarget: 1, // 活動王不設週解鎖門檻（殺 1 隻活動區怪即解鎖）
    battleTimeLimitMinutes: 120,
    respawnCooldownMinutes: 120,
    eliteZoneKey: "event_1",
    phaseConfig: [
      { phase: 1, hpBelowPercent: 70, atkMultiplier: 1.0, defMultiplier: 1.0, agiBonus: 0, note: "沉睡期：牠還以為你在幫牠抓癢" },
      { phase: 2, hpBelowPercent: 40, atkMultiplier: 1.25, defMultiplier: 1.0, agiBonus: 0, note: "甦醒期：海嘯詠唱解鎖" },
      { phase: 3, hpBelowPercent: 0, atkMultiplier: 1.5, defMultiplier: 1.1, agiBonus: 10, note: "怒濤期：整座島都在憤怒" },
    ],
  };
  await db.collection("worldBossConfig").updateOne(
    { bossKey: "island_turtle" },
    { $set: { ...cfg, bossKey: "island_turtle", updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
  console.log("已寫入 worldBossConfig（island_turtle）：三階段 70/40/0");

  // ── 島島寶箱 ──
  const chest = {
    id: "chest-island-turtle",
    name: "島島寶箱",
    description: "從龜王背上的沙灘裡挖出來的藏寶箱，還帶著椰子的香氣。\n【隨機內容・機率公開】開啟後獲得 1 項：島島龜王卡 1%｜S 階龜王武器 99%（11 種等機率，各 9%）。\n※本寶箱無保底機制。",
    itemType: "consumable",
    effect: { type: "open_world_boss_chest", monsterId: MONSTER_ID, bossName: "島島龜王" },
    useEffects: [],
    equipSlot: null,
    imageUrl: null, imageThumbnailUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const chestExist = await db.collection("items").findOne({ id: chest.id });
  if (chestExist) {
    const { createdAt, imageUrl, imageThumbnailUrl, ...rest } = chest;
    await db.collection("items").updateOne({ id: chest.id }, { $set: { ...rest, updatedAt: new Date().toISOString() } });
    console.log("已更新 島島寶箱");
  } else {
    await db.collection("items").insertOne(chest);
    console.log("已新增 島島寶箱");
  }
  console.log("提醒：①怪物 enabled:false ②龜王獎池由 upsert-event-beach-gear.js 同步 ③圖片由使用者補");
  await client.close();
}
main().catch((err) => { console.error(err); process.exit(1); });
