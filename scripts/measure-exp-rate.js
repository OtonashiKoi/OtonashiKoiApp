"use strict";
/**
 * 量測「每一級的實際經驗/小時」——重調升等曲線的前置資料。
 *
 * 參考情境固定成伺服器實況：同區 N 人（組隊倍率）＋裝備強化 +E。
 * 每一級：用該級打得到的最好裝備、選經驗/秒最高的區，實打 PROBE 場取平均。
 *
 * 輸出 JSON 到 docs/balance-reports/exp-rate-by-level.json 給 tune-exp-curve.js 用。
 *
 * 用法：node scripts/measure-exp-rate.js [同區人數] [強化等級] [每級場次]
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { ZONE_BY_KEY } = require("../src/shared/zones");
const { MAX_LEVEL } = require("../src/shared/progression");
const { getConfig, getMaxServerExpBuff } = require("../src/services/stream/streamEventConfig");
const jobBadgeLevel = require("../src/shared/jobBadgeLevel");

const PARTY = Math.max(1, Number(process.argv[2]) || 8);
const ENH = Math.max(0, Number(process.argv[3] ?? 5));
const PROBE = Math.max(6, Number(process.argv[4]) || 16);
const PARTY_MULT = PARTY <= 2 ? 1 : +(1 + Math.pow(PARTY - 2, 0.7) * 0.6).toFixed(2);
const ROUNDS = 15;
const DEATH_EXTRA_SEC = 10;
const MAXEXP = jobBadgeLevel.totalExpForLevel(jobBadgeLevel.MAX_JOB_LEVEL);
const FARM_ZONES = ["beginner", "normal", "mid", "ancient_city", "ancient_city_deep", "dragon_realm", "hellfire"];
const TIER_RANK = { D: 1, C: 2, B: 3, A: 4, S: 5 };

function tickDelayMs(agi = 1) {
  const base = 1500, min = 500, cap = 40;
  const c = Math.min(Math.max(1, agi), cap);
  return Math.round(base - ((c - 1) / (cap - 1)) * (base - min));
}
function zoneOpen(z, lv) {
  const d = ZONE_BY_KEY[z];
  if (!d) return false;
  if (d.minLevel > 1 && lv < d.minLevel) return false;
  if (d.maxLevel != null && lv > d.maxLevel) return false;
  return true;
}
// 屬性：2+1 制。隨機 +2 取期望值，自主 +1 以最快練等視角投入劍士主屬性 STR。
function attrsFor(level) {
  const randomPer = ((level - 1) * 2) / 6;
  const manualMain = level - 1;
  return {
    str: 1 + randomPer + manualMain,
    agi: 1 + randomPer,
    vit: 1 + randomPer,
    int: 1 + randomPer,
    dex: 1 + randomPer,
    luk: 1 + randomPer,
  };
}

(async () => {
  const db = await getMongoDb();
  const I = db.collection("items");
  const serverExpBuff = getMaxServerExpBuff(await getConfig());
  const { createServiceContext } = require("../src/services/createServiceContext");
  const sc = createServiceContext();

  const tierById = new Map();
  for (const it of await I.find({ itemType: "equipment" }).project({ id: 1, tier: 1 }).toArray()) {
    if (it.tier) tierById.set(String(it.id), String(it.tier).toUpperCase());
  }
  const zoneMobs = {}, zoneTiers = {};
  for (const z of FARM_ZONES) {
    const list = await sc.monsterService.listMonsters({ includeDisabled: false, zone: z }).catch(() => []);
    const mobs = (list || []).filter((m) => !m.isBoss && m.calc);
    if (!mobs.length) continue;
    zoneMobs[z] = mobs;
    const t = new Set();
    for (const m of mobs) for (const d of (m.drops || [])) {
      const tr = tierById.get(String(d?.itemId || ""));
      if (tr) t.add(tr);
    }
    zoneTiers[z] = t;
  }

  const gearCache = {};
  async function gearForTier(tier) {
    if (gearCache[tier]) return gearCache[tier];
    const eq = {};
    const w = await I.findOne({ weaponType: "sword_1h", tier, itemType: "equipment" });
    if (w) eq.weapon = { ...w, itemId: w.id, itemName: w.name, enhanceLevel: ENH };
    for (const slot of ["head_top", "armor", "garment", "shoes", "shield"]) {
      const it = await I.findOne({ equipSlot: slot, tier, itemType: "equipment", weaponType: null });
      if (it) eq[slot] = { ...it, itemId: it.id, itemName: it.name, enhanceLevel: ENH };
    }
    gearCache[tier] = eq;
    return eq;
  }
  const badge = await I.findOne({ id: "job_swordsman_v1" });

  const rows = [];
  for (let lv = 1; lv < MAX_LEVEL; lv++) {
    let tier = "D";
    for (const z of FARM_ZONES) {
      if (!zoneOpen(z, lv) || !zoneTiers[z]) continue;
      for (const t of zoneTiers[z]) if ((TIER_RANK[t] || 0) > (TIER_RANK[tier] || 0)) tier = t;
    }
    const eq = { ...(await gearForTier(tier)) };
    if (lv >= 10 && badge) {
      eq.job_eq = { ...badge, itemId: badge.id, itemName: badge.name, itemType: "job_badge", equipSlot: "job_eq", jobExp: MAXEXP };
    }
    const stats = calcPlayerStats(attrsFor(lv), eq, [], [], {});

    let best = null;
    for (const z of FARM_ZONES) {
      if (!zoneMobs[z] || !zoneOpen(z, lv)) continue;
      let expSum = 0, secSum = 0;
      for (let i = 0; i < PROBE; i++) {
        const m = zoneMobs[z][i % zoneMobs[z].length];
        const r = runCombatLoop(stats, m.calc, m.name, m.calc.maxHp, ROUNDS, {
          playerLevel: lv, equipped: eq, inventory: [],
          monsterEquipped: m.equipment || {}, monsterIsBoss: false,
          zone: z, monsterElement: m.element || null, monsterElementLevel: m.element ? (m.elementLevel || 1) : 0,
        });
        const ratio = Math.min(1, (r.totalDamage || 0) / m.calc.maxHp);
        const effectivePool = Math.round((m.expReward || 0) * PARTY_MULT);
        if (effectivePool > 0) {
          const baseShare = Math.max(1, Math.round(effectivePool * ratio));
          expSum += Math.max(1, Math.round(baseShare * serverExpBuff.multiplier));
        }
        secSum += (tickDelayMs(stats.agi || 1) / 1000) * ROUNDS + (r.outcome === "lose" ? DEATH_EXTRA_SEC : 0);
      }
      const perHour = secSum > 0 ? (expSum / secSum) * 3600 : 0;
      if (!best || perHour > best.perHour) best = { zone: z, perHour, secPerBattle: secSum / PROBE };
    }
    rows.push({ level: lv, tier, zone: best.zone, zoneLabel: ZONE_BY_KEY[best.zone]?.label || best.zone, expPerHour: Math.round(best.perHour) });
  }

  console.log(`═══ 經驗/小時（同區 ${PARTY} 人 ×${PARTY_MULT}　強化 +${ENH}　全服 EXP +${serverExpBuff.totalPct}%）═══\n`);
  console.log("等級  區域          裝備   經驗/小時");
  for (const r of rows) {
    if (r.level % 2 === 1 || r.level >= 40) {
      console.log(`Lv${String(r.level).padStart(2)}  ${r.zoneLabel.padEnd(12)} ${r.tier}階  ${r.expPerHour.toLocaleString().padStart(12)}`);
    }
  }
  const out = path.join(__dirname, "..", "docs", "balance-reports", "exp-rate-by-level.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({
    party: PARTY,
    partyMult: PARTY_MULT,
    enhance: ENH,
    probe: PROBE,
    serverExpBuff,
    allocation: "2 random + 1 STR per level",
    rows,
  }, null, 2));
  console.log(`\n已寫出 ${path.relative(process.cwd(), out)}`);
  process.exit(0);
})().catch((e) => { console.error("失敗：", e); process.exit(1); });
