"use strict";
/**
 * 練等模擬：Lv1 開始，實際打怪 → 升級 → 換裝 → 換區，一路跑到滿等，算要多久。
 *
 * 不用統計回推，就是照遊戲規則一場一場打：
 *   ‧ 每場走 runCombatLoop（真的戰鬥，含徽章技能/裝備效果）
 *   ‧ 經驗 ＝ expReward ×(這場傷害 ÷ 怪物血量) × 組隊倍率 × 全服滿加成
 *   ‧ 升級採 2+1 制：+2 隨機屬性點、+1 自主點投入劍士主屬性 STR
 *   ‧ 裝備跟著「目前打得到的區域」升階（掉落決定階級）
 *   ‧ 區域受 minLevel / maxLevel 限制，每級重選「經驗/秒」最高的區
 *   ‧ 每場耗時 ＝ 15 回合 × tickDelay(agi)；陣亡再 +10 秒
 *
 * ⚠️ 隨機 +2 的 AGI 抽多抽少會直接改變每場秒數，單一次跑的變異很大。
 *    要拿來校準曲線一定要跑多種子取平均（第 3 個參數）。
 *
 * 用法：node scripts/sim-level-run.js [同區人數] [強化等級] [跑幾輪]
 *   node scripts/sim-level-run.js 1 3        # 單人 +3，單輪（看路線）
 *   node scripts/sim-level-run.js 1 3 12     # 單人 +3，12 種子取平均（校準用）
 */

require("dotenv").config();
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { ZONES, ZONE_BY_KEY } = require("../src/shared/zones");
const { expToNextLevel, MAX_LEVEL } = require("../src/shared/progression");
const { getConfig, getMaxServerExpBuff } = require("../src/services/stream/streamEventConfig");
const jobBadgeLevel = require("../src/shared/jobBadgeLevel");

const PARTY = Math.max(1, Number(process.argv[2]) || 1);
const ENH = Math.max(0, Number(process.argv[3] ?? 0));
const RUNS = Math.max(1, Number(process.argv[4]) || 1);
const PARTY_MULT = PARTY <= 2 ? 1 : +(1 + Math.pow(PARTY - 2, 0.7) * 0.6).toFixed(2);
const ROUNDS = 15;
const PROBE = 12;              // 每次選區時每個候選區試打幾場
const DEATH_EXTRA_SEC = 10;    // DEATH_EXTRA_COOLDOWN_MS
const MAXEXP = jobBadgeLevel.totalExpForLevel(jobBadgeLevel.MAX_JOB_LEVEL);

// 一般怪物區（排掉世界王區與需付費的特殊區，那些不是練等主線）
const FARM_ZONES = ["beginner", "normal", "mid", "ancient_city", "ancient_city_deep", "dragon_realm", "hellfire"];

// calculateTickDelay（monsterZoneHandlers 用的同一條）
function tickDelayMs(agi = 1) {
  const base = 1500, min = 500, cap = 40;
  const c = Math.min(Math.max(1, agi), cap);
  return Math.round(base - ((c - 1) / (cap - 1)) * (base - min));
}

function zoneOpen(zoneKey, level) {
  const d = ZONE_BY_KEY[zoneKey];
  if (!d) return false;
  if (d.minLevel > 1 && level < d.minLevel) return false;
  if (d.maxLevel != null && level > d.maxLevel) return false;
  return true;
}

// 升級：+2 隨機屬性點；自主 +1 以最快練等視角投入劍士主屬性 STR。
function levelUpAttrs(attrs, rng) {
  const keys = ["str", "agi", "vit", "int", "dex", "luk"];
  for (let i = 0; i < 2; i++) attrs[keys[Math.floor(rng() * keys.length)]] += 1;
  attrs.str += 1;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 該區怪物實際掉落的裝備階級（決定玩家換得到什麼裝）
// drops 只有 itemId，階級要回 items 查
function tiersDroppedIn(monsters, tierById) {
  const t = new Set();
  for (const m of monsters) {
    for (const d of (m.drops || [])) {
      const tier = tierById.get(String(d?.itemId || ""));
      if (tier) t.add(String(tier).toUpperCase());
    }
  }
  return t;
}

const TIER_RANK = { D: 1, C: 2, B: 3, A: 4, S: 5 };

(async () => {
  const db = await getMongoDb();
  const I = db.collection("items");
  const serverExpBuff = getMaxServerExpBuff(await getConfig());
  const serverExpMult = serverExpBuff.multiplier;
  const { createServiceContext } = require("../src/services/createServiceContext");
  const sc = createServiceContext();

  // itemId → tier（只看真正的裝備，怪物卡/消耗品不算換裝來源）
  const tierById = new Map();
  for (const it of await I.find({ itemType: "equipment" }).project({ id: 1, tier: 1 }).toArray()) {
    if (it.tier) tierById.set(String(it.id), String(it.tier).toUpperCase());
  }

  // 撈各區怪物
  const zoneMobs = {};
  const zoneTiers = {};
  for (const z of FARM_ZONES) {
    const list = await sc.monsterService.listMonsters({ includeDisabled: false, zone: z }).catch(() => []);
    const mobs = (list || []).filter((m) => !m.isBoss && m.calc);
    if (!mobs.length) continue;
    zoneMobs[z] = mobs;
    zoneTiers[z] = tiersDroppedIn(mobs, tierById);
  }
  console.log("各區掉落階級：" + FARM_ZONES.filter((z) => zoneTiers[z])
    .map((z) => `${ZONE_BY_KEY[z]?.label || z}=${[...zoneTiers[z]].sort().join("/") || "無"}`).join("　"));

  // 預先撈好各階裝備（劍士基準）
  const gearCache = {};
  async function gearForTier(tier) {
    if (gearCache[tier]) return gearCache[tier];
    const eq = {};
    const w = await I.findOne({ weaponType: "sword_1h", tier, itemType: "equipment" });
    if (w) eq.weapon = { ...w, itemId: w.id, itemName: w.name };
    for (const slot of ["head_top", "armor", "garment", "shoes", "shield"]) {
      const it = await I.findOne({ equipSlot: slot, tier, itemType: "equipment", weaponType: null });
      if (it) eq[slot] = { ...it, itemId: it.id, itemName: it.name };
    }
    gearCache[tier] = eq;
    return eq;
  }
  const badge = await I.findOne({ id: "job_swordsman_v1" });

  function applyEnh(eq, enh) {
    const out = {};
    for (const [k, v] of Object.entries(eq)) out[k] = { ...v, enhanceLevel: enh };
    return out;
  }

  // 對齊線上結算順序：組隊池取整 → 傷害占比取整 → 全服 EXP 加成取整。
  function battleExpReward(monster, damageRatio) {
    const effectivePool = Math.round((Number(monster?.expReward) || 0) * PARTY_MULT);
    if (effectivePool <= 0) return 0;
    const baseShare = Math.max(1, Math.round(effectivePool * Math.min(1, Math.max(0, damageRatio))));
    return Math.max(1, Math.round(baseShare * serverExpMult));
  }

  // ── 開跑 ──
  async function runOnce(seed) {
  const rng = mulberry32(seed);
  const attrs = { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
  let level = 1, exp = 0, battles = 0, seconds = 0, deaths = 0;
  let bestTier = "D";
  const log = [];
  let curZone = null, curStats = null, curEq = null;

  function rebuildStats() {
    const base = gearCache[bestTier] || {};
    const eq = applyEnh(base, ENH);
    if (level >= 10 && badge) {
      eq.job_eq = { ...badge, itemId: badge.id, itemName: badge.name, itemType: "job_badge", equipSlot: "job_eq", jobExp: MAXEXP };
    }
    curEq = eq;
    curStats = calcPlayerStats({ ...attrs }, eq, [], [], {});
  }

  // 選區：試打各個開放區，取「經驗/秒」最高
  function chooseZone() {
    let best = null;
    for (const z of FARM_ZONES) {
      if (!zoneMobs[z] || !zoneOpen(z, level)) continue;
      let expSum = 0, secSum = 0;
      for (let i = 0; i < PROBE; i++) {
        const m = zoneMobs[z][i % zoneMobs[z].length];
        const r = runCombatLoop(curStats, m.calc, m.name, m.calc.maxHp, ROUNDS, {
          playerLevel: level, equipped: curEq, inventory: [],
          monsterEquipped: m.equipment || {}, monsterIsBoss: false,
          zone: z, monsterElement: m.element || null, monsterElementLevel: m.element ? (m.elementLevel || 1) : 0,
        });
        const share = Math.min(1, (r.totalDamage || 0) / m.calc.maxHp);
        expSum += battleExpReward(m, share);
        secSum += (tickDelayMs(curStats.agi || 1) / 1000) * ROUNDS + (r.outcome === "lose" ? DEATH_EXTRA_SEC : 0);
      }
      const rate = secSum > 0 ? expSum / secSum : 0;
      if (!best || rate > best.rate) best = { z, rate };
    }
    return best?.z || "normal";
  }

  rebuildStats();
  curZone = chooseZone();
  let lastZone = curZone, lastTier = bestTier, segStartBattles = 0, segStartSec = 0, segStartLv = 1;

  const HARD_CAP = 3_000_000;   // 保險絲
  while (level < MAX_LEVEL && battles < HARD_CAP) {
    const mobs = zoneMobs[curZone];
    const m = mobs[Math.floor(rng() * mobs.length)];
    const r = runCombatLoop(curStats, m.calc, m.name, m.calc.maxHp, ROUNDS, {
      playerLevel: level, equipped: curEq, inventory: [],
      monsterEquipped: m.equipment || {}, monsterIsBoss: false,
      zone: curZone, monsterElement: m.element || null, monsterElementLevel: m.element ? (m.elementLevel || 1) : 0,
    });
    battles++;
    const died = r.outcome === "lose";
    if (died) deaths++;
    seconds += (tickDelayMs(curStats.agi || 1) / 1000) * ROUNDS + (died ? DEATH_EXTRA_SEC : 0);

    const share = Math.min(1, (r.totalDamage || 0) / m.calc.maxHp);
    exp += battleExpReward(m, share);

    let leveled = false;
    while (level < MAX_LEVEL && exp >= expToNextLevel(level)) {
      exp -= expToNextLevel(level);
      level++;
      levelUpAttrs(attrs, rng);
      leveled = true;
    }
    if (!leveled) continue;

    // 換裝：目前打得到的區會掉更好的階級就換
    let newTier = bestTier;
    for (const z of FARM_ZONES) {
      if (!zoneOpen(z, level) || !zoneTiers[z]) continue;
      for (const t of zoneTiers[z]) if ((TIER_RANK[t] || 0) > (TIER_RANK[newTier] || 0)) newTier = t;
    }
    const tierChanged = newTier !== bestTier;
    bestTier = newTier;
    if (!gearCache[bestTier]) await gearForTier(bestTier);
    rebuildStats();

    const z = chooseZone();
    const zoneChanged = z !== curZone;
    curZone = z;

    if (tierChanged || zoneChanged) {
      log.push({
        lv: segStartLv, toLv: level,
        zone: ZONE_BY_KEY[lastZone]?.label || lastZone, tier: lastTier,
        battles: battles - segStartBattles, hours: (seconds - segStartSec) / 3600,
      });
      segStartBattles = battles; segStartSec = seconds; segStartLv = level;
      lastZone = curZone; lastTier = bestTier;
    }
  }
  log.push({
    lv: segStartLv, toLv: level,
    zone: ZONE_BY_KEY[lastZone]?.label || lastZone, tier: lastTier,
    battles: battles - segStartBattles, hours: (seconds - segStartSec) / 3600,
  });

  return { log, battles, seconds, deaths };
  }

  const results = [];
  for (let i = 0; i < RUNS; i++) results.push(await runOnce(20260805 + i * 7919));
  const { log, battles, seconds, deaths } = results[0];

  console.log(`═══ Lv1 → Lv${MAX_LEVEL} 實跑模擬 ═══`);
  console.log(`職業：劍士（自主點全 STR）　同區 ${PARTY} 人（組隊倍率 ×${PARTY_MULT}）　裝備強化 +${ENH}`);
  console.log(`全服 EXP 滿加成：+${serverExpBuff.totalPct}%（永久 +${serverExpBuff.permanentPct}%／斗內短期 +${serverExpBuff.shortTermPct}%／觀看 +${serverExpBuff.viewerPct}%）×${serverExpMult.toFixed(2)}\n`);
  console.log("等級區間      farm 區域        裝備   場次      時數");
  console.log("─".repeat(58));
  for (const s of log) {
    if (s.toLv <= s.lv) continue;
    console.log(
      `Lv${String(s.lv).padStart(2)}→${String(s.toLv).padEnd(3)}  ${String(s.zone).padEnd(14)} ${s.tier}階  ${
        s.battles.toLocaleString().padStart(8)}  ${s.hours.toFixed(1).padStart(7)} h`
    );
  }
  const hours = seconds / 3600;
  console.log("─".repeat(58));
  console.log(`合計　　　　　　　　　　　　　　${battles.toLocaleString().padStart(10)}  ${hours.toFixed(1).padStart(7)} h`);
  console.log(`陣亡 ${deaths.toLocaleString()} 次（${(deaths / battles * 100).toFixed(1)}%）`);
  let avgHours = hours;
  if (RUNS > 1) {
    const hs = results.map((r) => r.seconds / 3600).sort((a, b) => a - b);
    const bs = results.map((r) => r.battles);
    avgHours = hs.reduce((a, b) => a + b, 0) / hs.length;
    console.log(`\n【${RUNS} 種子統計】（上表只是第 1 輪的路線）`);
    console.log(`  時數　平均 ${avgHours.toFixed(1)} h　中位 ${hs[Math.floor(hs.length / 2)].toFixed(1)} h　範圍 ${hs[0].toFixed(1)} ~ ${hs[hs.length - 1].toFixed(1)} h`);
    console.log(`  場次　平均 ${Math.round(bs.reduce((a, b) => a + b, 0) / bs.length).toLocaleString()}`);
  }
  console.log(`\n每天投入 → 滿等天數（用${RUNS > 1 ? "平均" : "本輪"}時數）`);
  for (const h of [1, 2, 3, 5, 6, 8]) {
    console.log(`  ${String(h).padStart(2)} 小時/天 → ${(avgHours / h).toFixed(1)} 天`);
  }
  process.exit(0);
})().catch((e) => { console.error("失敗：", e); process.exit(1); });
