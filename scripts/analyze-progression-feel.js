"use strict";
/**
 * 成長手感曲線：從低等到滿等，各等級打各區怪物的實際體感。
 *
 * 【經驗怎麼發的】monsterZoneHandlers.js:4113
 *   經驗不是「打一場給一次」，是**怪物被打死時、依傷害佔比分配**：
 *     你這場的經驗 ＝ expReward × (你這場的傷害 ÷ 怪物總血量)
 *   ⚠️ 陣亡不會讓經驗歸零——傷害仍記在 mergedDmg，怪死時照樣分你一份。
 *      陣亡的成本只有「多 10 秒冷卻」(DEATH_EXTRA_COOLDOWN_MS)。
 *
 * 所以唯一有意義的軸是 **經驗/小時**：
 *   (傷害÷血量) × expReward ÷ (每場秒數 + 陣亡?10秒)
 *
 * 玩家模型照真實情況：
 *   ‧ 配點平均分配（升級是隨機 +2，玩家無法集中）
 *   ‧ 裝備階級依等級帶走（低等 D/C → 中段 B → 後段 A → 滿等 A+高強化）
 *   ‧ 徽章 Lv20 滿級（Lv10 以後才有徽章）
 *
 * 用法：node scripts/analyze-progression-feel.js [每格場次]
 */

require("dotenv").config();
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { ZONE_BY_KEY } = require("../src/shared/zones");
const jobBadgeLevel = require("../src/shared/jobBadgeLevel");

const RUNS = Math.max(10, Number(process.argv[2]) || 25);
const ROUNDS = 15;
const BASE_SEC = 15;   // 15 回合 × ~1 秒/回合（calculateTickDelay 1500→500ms）
const MAXEXP = jobBadgeLevel.totalExpForLevel(jobBadgeLevel.MAX_JOB_LEVEL);

// 等級 → 該階段玩家的實際配置（階級／強化／有沒有徽章）
const LEVEL_BANDS = [
  { lv: 5, tier: "D", enh: 0, badge: false },
  { lv: 10, tier: "C", enh: 1, badge: true },
  { lv: 15, tier: "C", enh: 2, badge: true },
  { lv: 20, tier: "B", enh: 2, badge: true },
  { lv: 25, tier: "B", enh: 3, badge: true },
  { lv: 30, tier: "B", enh: 4, badge: true },
  { lv: 35, tier: "A", enh: 3, badge: true },
  { lv: 40, tier: "A", enh: 4, badge: true },
  { lv: 45, tier: "A", enh: 5, badge: true },
  { lv: 50, tier: "A", enh: 7, badge: true },
];

const ZONE_ORDER = ["beginner", "normal", "mid", "ancient_city", "ancient_city_deep", "dragon_realm", "hellfire"];

function buildAttrs(level) {
  const total = 6 + (level - 1) * 2;
  const a = { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
  const free = total - 6;
  const per = Math.floor(free / 6);
  for (const k of Object.keys(a)) a[k] += per;
  a.vit += free - per * 6;
  return a;
}

async function buildEquipment(I, band) {
  // 用劍士當基準職業（中庸：不像盜賊靠次數、也不像結界師零輸出）
  const weapon = await I.findOne({ weaponType: "sword_1h", tier: band.tier, itemType: "equipment" })
    || await I.findOne({ weaponType: "sword_1h", itemType: "equipment" });
  const eq = { weapon: { ...weapon, itemId: weapon.id, itemName: weapon.name, enhanceLevel: band.enh } };
  for (const slot of ["head_top", "armor", "garment", "shoes", "shield"]) {
    const it = await I.findOne({ equipSlot: slot, tier: band.tier, itemType: "equipment", weaponType: null });
    if (it) eq[slot] = { ...it, itemId: it.id, enhanceLevel: band.enh };
  }
  if (band.badge) {
    const b = await I.findOne({ id: "job_swordsman_v1" });
    if (b) eq.job_eq = { ...b, itemId: b.id, itemName: b.name, itemType: "job_badge", equipSlot: "job_eq", jobExp: MAXEXP };
  }
  return eq;
}

(async () => {
  const db = await getMongoDb();
  const I = db.collection("items");
  const { createServiceContext } = require("../src/services/createServiceContext");
  const sc = createServiceContext();

  const zones = {};
  for (const z of ZONE_ORDER) {
    const list = await sc.monsterService.listMonsters({ includeDisabled: false, zone: z }).catch(() => []);
    const mobs = list.filter((m) => !m.isBoss);
    if (mobs.length) zones[z] = mobs;
  }

  console.log("═══ 成長手感曲線 ═══");
  console.log(`基準職業：劍士（中庸）／配點平均分配／徽章 Lv20／每格 ${RUNS} 場\n`);
  const zk = Object.keys(zones);
  const header = "等級  裝備      " + zk.map((z) => (ZONE_BY_KEY[z]?.label || z).slice(0, 5).padEnd(11)).join("");
  console.log(header);
  console.log("─".repeat(header.length + 4));

  for (const band of LEVEL_BANDS) {
    const eq = await buildEquipment(I, band);
    const pStats = calcPlayerStats(buildAttrs(band.lv), eq, [], [], {});
    const cells = [];
    const rowExp = [];
    for (const z of zk) {
      let deaths = 0, n = 0, expAccum = 0;
      for (const m of zones[z]) {
        for (let i = 0; i < RUNS; i++) {
          const r = runCombatLoop(pStats, m.calc, m.name, m.calc.maxHp, ROUNDS, {
            playerLevel: band.lv, equipped: eq, inventory: [],
            monsterEquipped: m.equipment || {}, monsterIsBoss: false,
            zone: z, monsterElement: m.element || null, monsterElementLevel: m.element ? (m.elementLevel || 1) : 0,
          });
          expAccum += Math.min(1, (r.totalDamage || 0) / m.calc.maxHp) * (m.expReward || 0);
          if (r.outcome === "lose") deaths++;
          n++;
        }
      }
      const deathPct = (deaths / n) * 100;
      // 經驗＝傷害佔比 × expReward（怪死時分配），陣亡不歸零
      const expPerBattle = expAccum / n;
      const secPerBattle = BASE_SEC + (deathPct / 100) * 10;   // 陣亡只多 10 秒冷卻
      const expPerHour = (expPerBattle / secPerBattle) * 3600;
      const mark = deathPct >= 50 ? "☠" : deathPct >= 20 ? "⚠" : " ";
      rowExp.push(expPerHour);
      cells.push(`${mark}${Math.round(expPerHour).toLocaleString()}`.padEnd(11));
    }
    const best = rowExp.indexOf(Math.max(...rowExp));
    console.log(`Lv${String(band.lv).padStart(2)}  ${band.tier}階+${band.enh}   ${cells.join("")}→ 最佳：${(ZONE_BY_KEY[zk[best]]?.label || zk[best])}`);
  }

  console.log("\n圖例：每格＝**經驗/小時**（單人、無組隊倍率、無掛機）");
  console.log("  ⚠ 陣亡率 ≥20%｜☠ ≥50%（陣亡只多 10 秒冷卻，不扣經驗）");
  console.log("\n※ 經驗＝expReward ×(你的傷害÷怪物血量)，怪死時分配。打不死不影響收益。");
  process.exit(0);
})().catch((e) => { console.error("失敗：", e); process.exit(1); });
