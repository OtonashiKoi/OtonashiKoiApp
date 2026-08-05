"use strict";
/**
 * 職業強度表 —— 打**實際區域的真實怪物**，用**每場輸出**當指標。
 *
 * 為什麼改用真怪：先前用單一隻低防假人量，會系統性低估減防型職業（劍士碎甲斬、軍師戰術分析、
 * 法師無視防禦），也量不出迴避/命中/怪物反擊的影響。玩家真正在打的是各區的怪，
 * 那些怪的 def / flatDef / dodge / atk 分佈才是真實戰鬥條件。
 *
 * 作法：
 *   ‧ 標準 Lv35 玩家：74 點**平均分配**（升級是隨機+2，無法集中）、A 階 +3（實測真實玩家配置）、徽章 Lv20
 *   ‧ 每個職業對「該區所有啟用中的怪」各打 N 場，取整區平均
 *   ‧ **指標＝每場輸出，不是「打死沒」**——區域怪的血量是全服共享、跨場累積的
 *     （monsterState.currentHp，古城弓手 10,500 血、已被打 8,500 次），
 *     單一玩家單場本來就打不死，用勝率當指標等於在量一個遊戲裡不存在的情境。
 *   ‧ 同時量陣亡率：輸出再高，一直死也是問題
 *   ‧ 職業技能（jobSkills）自動觸發（每回合 35%），模擬照常跑到
 *
 * 用法：
 *   node scripts/balance-job-real-zones.js                  # 預設三區
 *   node scripts/balance-job-real-zones.js 200 B            # 樣本數、裝備階級
 */

require("dotenv").config();
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const jobAdvancement = require("../src/shared/jobAdvancement");
const jobBadgeLevel = require("../src/shared/jobBadgeLevel");

const RUNS = Math.max(20, Number(process.argv[2]) || 60);
const TIER = (process.argv[3] || "A").toUpperCase();   // 真實玩家 14 人裡 11 人拿 A 階
const LEVEL = 35;
const POINTS = 6 + (LEVEL - 1) * 2;
const ENHANCE = 3;   // 真實玩家武器平均 +3.4
const ROUNDS = 15;
const MAXEXP = jobBadgeLevel.totalExpForLevel(jobBadgeLevel.MAX_JOB_LEVEL);

// Lv35 玩家實際會打的區（由低到高）
const ZONES = ["mid", "ancient_city", "ancient_city_deep"];

// 職業 → [武器類型, 主屬性, 額外]
const JOBS = {
  swordsman: ["sword_1h", "str", { shield: true }],
  warrior: ["axe_2h", "str", {}],
  dwarf_warrior: ["mace_2h", "str", {}],
  rogue: ["dagger", "agi", { dual: true }],
  mage: ["staff_2h", "int", {}],
  healer: ["staff_1h", "int", { shield: true }],
  archer: ["bow", "dex", {}],
  tactician: ["staff_2h", "int", {}],      // 不綁武器，配點對齊
  bard: ["bow", "dex", {}],
  barrier_mage: ["staff_1h", "int", { shield: true }],
  gambler: ["dice", "luk", {}],
};

// ⚠️ 升級是「隨機 +2」（progressService），玩家沒辦法集中配點。
// 真實 Lv30~45 玩家的屬性是平的（例：S12 A13 V12 I11 D17 L9）——
// 先前用「主屬 55%」的集中配點模擬，把主屬驅動的職業（尤其盜賊的 AGI→連擊）灌水了一倍以上。
// 這裡改成平均分配＝隨機分配的期望值。
function buildAttrs() {
  const a = { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
  const free = POINTS - 6;
  const per = Math.floor(free / 6);
  for (const k of Object.keys(a)) a[k] += per;
  a.vit += free - per * 6;   // 零頭
  return a;
}

async function buildEquipment(I, badgeId, wType, extra) {
  const badge = await I.findOne({ id: badgeId });
  const weapon = await I.findOne({ weaponType: wType, tier: TIER, itemType: "equipment" });
  if (!badge || !weapon) return null;
  // 徽章 Lv20 滿級：屬性值 ×1.5（見 jobBadgeLevel）；jobSkills 隨物件帶入，戰鬥中自動觸發
  const eq = {
    job_eq: { ...badge, itemId: badge.id, itemName: badge.name, itemType: "job_badge", equipSlot: "job_eq", jobExp: MAXEXP },
    weapon: { ...weapon, itemId: weapon.id, itemName: weapon.name, enhanceLevel: ENHANCE },
  };
  for (const slot of ["head_top", "armor", "garment", "shoes"]) {
    const it = await I.findOne({ equipSlot: slot, tier: TIER, itemType: "equipment", weaponType: null });
    if (it) eq[slot] = { ...it, itemId: it.id, enhanceLevel: ENHANCE };
  }
  if (extra.dual) {
    const off = await I.findOne({ weaponType: "offhand_dagger", tier: TIER });
    if (off) eq.shield = { ...off, itemId: off.id, enhanceLevel: ENHANCE };
  } else if (extra.shield) {
    const sh = await I.findOne({ equipSlot: "shield", tier: TIER, weaponType: null });
    if (sh) eq.shield = { ...sh, itemId: sh.id, enhanceLevel: ENHANCE };
  }
  return eq;
}

(async () => {
  const db = await getMongoDb();
  const I = db.collection("items");
  const { createServiceContext } = require("../src/services/createServiceContext");
  const { createMongoRepositories } = require("../src/adapters/mongo/createMongoRepositories");
  const sc = await createServiceContext(await createMongoRepositories());

  // 各區真實怪物（含 calc：實際戰鬥用的數值）
  const zoneMonsters = {};
  for (const z of ZONES) {
    const list = await sc.monsterService.listMonsters({ includeDisabled: false, zone: z });
    zoneMonsters[z] = list.filter((m) => !m.isBoss);
  }

  console.log(`═══ 職業強度・真實怪物 ═══`);
  console.log(`Lv${LEVEL}／${TIER} 階整套 +${ENHANCE}／徽章 Lv20 滿級／每隻怪 ${RUNS} 場／職業技能自動觸發\n`);
  for (const z of ZONES) {
    const ms = zoneMonsters[z];
    const lv = ms.map((m) => m.level || 0);
    const def = ms.map((m) => m.calc?.def || 0);
    console.log(`  ${z}：${ms.length} 隻｜Lv${Math.min(...lv)}~${Math.max(...lv)}｜DEF ${Math.min(...def)}~${Math.max(...def)}`);
  }
  console.log();

  const rows = [];
  for (const [key, info] of Object.entries(jobAdvancement.BASE_JOBS)) {
    const [wType, mainStat, extra = {}] = JOBS[key] || [];
    if (!wType) continue;
    const eq = await buildEquipment(I, info.badgeId, wType, extra);
    if (!eq) { console.log(`${info.name} 缺裝備，跳過`); continue; }
    const pStats = calcPlayerStats(buildAttrs(), eq, [], [], {});

    const perZone = {};
    for (const z of ZONES) {
      let total = 0, dmg = 0, deaths = 0, taken = 0;
      for (const m of zoneMonsters[z]) {
        for (let i = 0; i < RUNS; i++) {
          const r = runCombatLoop(pStats, m.calc, m.name, m.calc.maxHp, ROUNDS, {
            playerLevel: LEVEL, equipped: eq, inventory: [],
            monsterEquipped: m.equipment || {}, monsterIsBoss: false,
            zone: z, monsterElement: m.element || null,
          });
          total++;
          dmg += r.totalDamage || 0;
          taken += r.damageTaken || 0;
          if (r.outcome === "lose") deaths++;
        }
      }
      perZone[z] = { dmg: dmg / total, deathPct: (deaths / total) * 100, taken: taken / total };
    }
    rows.push({ name: info.name, perZone });
  }

  const label = { mid: "陽光草原", ancient_city: "古城", ancient_city_deep: "古城深處" };
  const score = (r) => ZONES.reduce((s, z) => s + r.perZone[z].dmg, 0) / ZONES.length;
  rows.sort((a, b) => score(b) - score(a));
  const median = score(rows[Math.floor(rows.length / 2)]);

  console.log("職業".padEnd(10) + ZONES.map((z) => (label[z] + " 均傷").padEnd(16)).join("") + "平均".padEnd(11) + "相對中位".padEnd(11) + "陣亡率");
  console.log("─".repeat(10 + ZONES.length * 16 + 30));
  for (const r of rows) {
    const cells = ZONES.map((z) => Math.round(r.perZone[z].dmg).toLocaleString().padEnd(16)).join("");
    const avg = score(r);
    const rel = (avg / median) * 100;
    const dth = ZONES.reduce((s, z) => s + r.perZone[z].deathPct, 0) / ZONES.length;
    const flag = rel >= 150 ? " ⚠️過高" : rel <= 60 ? " ⚠️過低" : "";
    console.log(r.name.padEnd(10) + cells + Math.round(avg).toLocaleString().padEnd(11)
      + (rel.toFixed(0) + "%").padEnd(11) + dth.toFixed(0) + "%" + flag);
  }

  console.log("\n※ 均傷＝單場 15 回合打出的傷害（區域怪血量全服共享，單場打不死是正常的）");
  console.log("※ 陣亡率＝單場被打死的比例");
  const best = rows[0], worst = rows[rows.length - 1];
  console.log(`※ 最高 ${best.name} ${Math.round(score(best)).toLocaleString()} ／ 最低 ${worst.name} ${Math.round(score(worst)).toLocaleString()} → 差距 ${(score(best) / score(worst)).toFixed(1)}×`);
  process.exit(0);
})().catch((e) => { console.error("失敗：", e); process.exit(1); });
