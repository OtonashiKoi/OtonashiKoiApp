"use strict";
/**
 * 二轉試煉「鏡影之戰」血量反推模擬。
 *
 * 規格（使用者定案 2026-08-03）：
 *   ‧ 個人戰、必須配戴該一轉徽章、鏡影血量跨場累積扣（磨血）
 *   ‧ **10 場內要打贏**，一場 15 回合 → 總計 150 回合
 *   ‧ 目標難度「要準備一下」＝標準配裝的玩家約 60% 成功率
 *
 * 作法：
 *   ① 造「標準 Lv35 玩家」：74 點（起始 6 ＋ 34 級 ×2）、A 階整套 +5、該職業徽章
 *   ② 鏡影 ＝ 同一套配點的鏡像（主題：打敗過去的自己）→ 每個職業的鏡影自然不同
 *   ③ 鏡影血量設無限大，跑滿 10 場 ×15 回合，量「150 回合內打得出多少總傷害」
 *      （玩家中途陣亡 → 該場提早結束，傷害自然變少，風險有被計入）
 *   ④ 取樣本分佈的 **60 百分位** 當血量 → 約 60% 的嘗試打得完
 *
 * 用法：node scripts/sim-t2-mirror-trial.js [樣本數]
 */

require("dotenv").config();
const { runCombatLoop } = require("../src/shared/combatLoop");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const SAMPLES = Math.max(50, Number(process.argv[2]) || 400);
const PLAYER_LEVEL = 35;
const TOTAL_POINTS = 6 + (PLAYER_LEVEL - 1) * 2;   // 每級自動 +2
const BATTLES = 10;
const ROUNDS_PER_BATTLE = 15;
const TARGET_WIN = 0.60;         // 目標成功率：約 60% 的嘗試能在 10 場內打完
const ENHANCE = 5;               // 標準配裝：該等級的階級整套 +5
const TIER = (process.argv[3] || "B").toUpperCase();   // Lv35 實際拿得到的階級

// 光環型：徽章效果以 party_* 為主，單人打鏡影時大半不生效
//   → 試煉進度改成「打的量 ＋ 守護量」一起算（使用者定案 2026-08-03）
const AURA_JOBS = new Set(["治療師", "結界師", "詩人", "軍師"]);

// 一轉職業 → [顯示名, 徽章id, 武器類型, 主屬性, 額外]
const T1_JOBS = [
  ["劍士", "job_swordsman_v1", "sword_1h", "str", { shield: true }],
  ["戰士", "job_warrior_v1", "axe_2h", "str", {}],
  ["矮人戰士", "job_dwarf_warrior_v1", "mace_2h", "str", {}],
  ["盜賊", "job_rogue_v1", "dagger", "agi", { dualDagger: true }],
  ["法師", "job_mage_v1", "staff_2h", "int", {}],
  ["治療師", "job_healer_v1", "staff_1h", "int", { shield: true }],
  ["弓箭手", "job_archer_v1", "bow", "dex", {}],
  ["軍師", "job_tactician_v1", "staff_2h", "int", {}],
  ["詩人", "job_bard_v1", "bow", "dex", {}],
  ["結界師", "job_barrier_mage_v1", "staff_1h", "int", { shield: true }],
  ["賭徒", "job_gambler_v1", "dice", "luk", {}],
];

/** 標準配點：六維各 1 起跳，主屬性 55%、VIT 30%、其餘補 AGI */
function buildAttrs(mainStat) {
  const a = { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
  const free = TOTAL_POINTS - 6;
  const toMain = Math.round(free * 0.55);
  const toVit = Math.round(free * 0.30);
  a[mainStat] += toMain;
  a.vit += toVit;
  a.agi += free - toMain - toVit;
  return a;
}

async function buildEquipment(db, job) {
  const items = db.collection("items");
  const [, badgeId, wType, , extra = {}] = job;
  const badge = await items.findOne({ id: badgeId });
  const weapon = await items.findOne({ weaponType: wType, tier: TIER, itemType: "equipment" });
  if (!badge || !weapon) return null;

  const eq = {};
  eq.job_eq = { ...badge, itemId: badge.id, itemName: badge.name, uuid: "sim-badge" };
  eq.weapon = { ...weapon, itemId: weapon.id, itemName: weapon.name, uuid: "sim-weapon", enhanceLevel: ENHANCE };
  // A 階整套防具
  for (const slot of ["head_top", "armor", "garment", "shoes"]) {
    const it = await items.findOne({ equipSlot: slot, tier: TIER, itemType: "equipment", weaponType: null });
    if (it) eq[slot] = { ...it, itemId: it.id, itemName: it.name, uuid: "sim-" + slot, enhanceLevel: ENHANCE };
  }
  if (extra.dualDagger) {
    const off = await items.findOne({ weaponType: "offhand_dagger", tier: TIER });
    if (off) eq.shield = { ...off, itemId: off.id, itemName: off.name, uuid: "sim-off", enhanceLevel: ENHANCE };
  } else if (extra.shield) {
    const sh = await items.findOne({ equipSlot: "shield", tier: TIER, weaponType: null });
    if (sh) eq.shield = { ...sh, itemId: sh.id, itemName: sh.name, uuid: "sim-shield", enhanceLevel: ENHANCE };
  }
  return eq;
}

/** 鏡影 ＝ 玩家自己的鏡像（沿用怪物 calc 的欄位形狀；攻防打 85 折＝牠沒有你的附魔） */
function buildMirror(name, pStats, hp) {
  const M = 0.85;
  return {
    name: `鏡影・${name}`,
    level: PLAYER_LEVEL,
    maxHp: hp,
    atk: Math.max(1, Math.round((pStats.atk || 0) * M)),
    def: Math.max(0, Math.round((pStats.def || 0) * M)),
    flatDef: Math.max(0, Math.round((pStats.flatDef || 0) * M)),
    agi: Math.max(1, Math.round((pStats.agi || 1) * M)),
    int: Math.max(1, Math.round((pStats.int || 1) * M)),
    dodge: (pStats.dodge || 0) * M,
    hit: pStats.hit || 90,
    critRate: (pStats.crit || 0) * M,
    comboChance: (pStats.combo || 0) * M,
    dmgMin: pStats.dmgMin ?? 0.8,
    dmgMax: pStats.dmgMax ?? 1,
    defIgnorePct: 0,
    blockChance: 0,
    incomingDamageCap: 0,
    isBoss: false,
  };
}

/** 跑一次完整試煉（最多 10 場磨血）→ { win, battlesUsed, deaths } */
function runTrial(pStats, eq, mirrorHp, name) {
  let hpLeft = mirrorHp;
  let deaths = 0;
  for (let b = 1; b <= BATTLES; b++) {
    const mirror = buildMirror(name, pStats, mirrorHp);
    const r = runCombatLoop(pStats, mirror, mirror.name, hpLeft, ROUNDS_PER_BATTLE, {
      playerLevel: PLAYER_LEVEL,
      equipped: eq,
      inventory: [],
      monsterIsBoss: false,
    });
    const isAura = AURA_JOBS.has(name);
    const gain = (r.totalDamage || 0)
      + (isAura ? ((r.healDone || 0) + (r.damageTaken || 0)) : 0);
    hpLeft -= gain;
    if (r.outcome === "lose") deaths++;
    if (hpLeft <= 0) return { win: true, battlesUsed: b, deaths };
  }
  return { win: false, battlesUsed: BATTLES, deaths };
}

/** 二分搜尋：找出「勝率最接近 TARGET_WIN」的血量 */
function solveHp(pStats, eq, name, samples) {
  const measure = (hp) => {
    let w = 0, bu = 0, d = 0;
    for (let i = 0; i < samples; i++) {
      const r = runTrial(pStats, eq, hp, name);
      if (r.win) { w++; bu += r.battlesUsed; }
      d += r.deaths;
    }
    return { rate: w / samples, avgBattles: w ? bu / w : BATTLES, avgDeaths: d / samples };
  };
  let lo = 1000, hi = 1000;
  while (measure(hi).rate > TARGET_WIN && hi < 1e9) hi *= 2;   // 先撐出上界
  let best = null;
  for (let it = 0; it < 12; it++) {
    const mid = Math.round((lo + hi) / 2);
    const m = measure(mid);
    if (!best || Math.abs(m.rate - TARGET_WIN) < Math.abs(best.rate - TARGET_WIN)) best = { hp: mid, ...m };
    if (m.rate > TARGET_WIN) lo = mid; else hi = mid;
  }
  return best;
}

const pctl = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

(async () => {
  const db = await getMongoDb();
  console.log(`═══ 鏡影之戰・血量反推 ═══`);
  console.log(`Lv${PLAYER_LEVEL}／配點 ${TOTAL_POINTS} 點／${TIER} 階整套 +${ENHANCE}／${BATTLES} 場 × ${ROUNDS_PER_BATTLE} 回合＝${BATTLES * ROUNDS_PER_BATTLE} 回合／樣本 ${SAMPLES}\n`);
  console.log("職業".padEnd(10) + "軌道".padEnd(8) + "進度門檻".padEnd(16) + "實測成功率".padEnd(14) + "平均用幾場".padEnd(14) + "平均陣亡次數");
  console.log("─".repeat(70));

  const out = [];
  for (const job of T1_JOBS) {
    const [name, , , mainStat] = job;
    const eq = await buildEquipment(db, job);
    if (!eq) { console.log(`${name.padEnd(10)}（缺徽章或武器，跳過）`); continue; }
    const attrs = buildAttrs(mainStat);
    const pStats = calcPlayerStats(attrs, eq, [], [], {});
    const best = solveHp(pStats, eq, name, SAMPLES);
    console.log(
      name.padEnd(10)
      + (AURA_JOBS.has(name) ? "光環" : "輸出").padEnd(8)
      + best.hp.toLocaleString().padEnd(16)
      + (best.rate * 100).toFixed(0).padStart(3) + "%".padEnd(11)
      + best.avgBattles.toFixed(1).padEnd(14)
      + best.avgDeaths.toFixed(1)
    );
    out.push({ name, hp: best.hp, rate: best.rate, avgBattles: best.avgBattles, deaths: best.avgDeaths });
  }

  console.log("\n※ 進度門檻＝二分搜尋出「成功率最接近 60%」的值（真實磨血模擬，含中途陣亡損失的回合）。");
  const vals = out.map((o) => o.hp);
  if (vals.length) {
    console.log(`※ 各職業差距：最低 ${Math.min(...vals).toLocaleString()} ／ 最高 ${Math.max(...vals).toLocaleString()}（倍率 ${(Math.max(...vals) / Math.min(...vals)).toFixed(1)}×）`);
  }
  process.exit(0);
})().catch((e) => { console.error("失敗：", e); process.exit(1); });
