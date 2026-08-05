"use strict";
/**
 * 一轉職業傷害對照表 —— 全部職業打**同一隻固定假人**，才是乾淨的 DPS 比較。
 *
 * （鏡影血量表不能拿來當傷害排名：每個職業打的是自己的鏡影，防禦/迴避都不同。）
 *
 * 標準玩家：Lv35／74 點（主 55% + VIT 30% + AGI 15%）／A 階整套 +5／該職業徽章
 * 假人：固定 def/flatDef、血量無限（不會死也不還手 → 純測輸出上限）
 *   另跑一組「會還手」的版本，看陣亡對實際輸出的侵蝕。
 *
 * 用法：node scripts/sim-t1-damage-table.js [樣本數]
 */

require("dotenv").config();
const { runCombatLoop } = require("../src/shared/combatLoop");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const SAMPLES = Math.max(50, Number(process.argv[2]) || 300);
const PLAYER_LEVEL = 35;
const TOTAL_POINTS = 6 + (PLAYER_LEVEL - 1) * 2;
const ROUNDS = 15;
const BATTLES = 10;
const ENHANCE = 5;
const TIER = (process.argv[4] || "B").toUpperCase();   // 該等級實際拿得到的階級（Lv35＝古城 B 階）

const T1_JOBS = [
  ["劍士", "job_swordsman_v1", "sword_1h", "str", { shield: true }],
  ["戰士", "job_warrior_v1", "axe_2h", "str", {}],
  ["矮人戰士", "job_dwarf_warrior_v1", "mace_2h", "str", {}],
  ["盜賊", "job_rogue_v1", "dagger", "agi", { dualDagger: true }],
  ["法師", "job_mage_v1", "staff_2h", "int", {}],
  ["治療師", "job_healer_v1", "staff_1h", "int", { shield: true }],
  ["弓箭手", "job_archer_v1", "bow", "dex", {}],
  ["軍師", "job_tactician_v1", "staff_2h", "int", {}],   // 2026-08-03 起徽章不綁武器 → 配點對齊主屬
  ["詩人", "job_bard_v1", "bow", "dex", {}],
  ["結界師", "job_barrier_mage_v1", "staff_1h", "int", { shield: true }],
  ["賭徒", "job_gambler_v1", "dice", "luk", {}],
];

// 固定假人：Lv35 一般怪的防禦水準；血量夠大不會被打死
const DUMMY_HP = Number(process.argv[3]) || 60_000;   // 實際規模！DOT/毒傷按 maxHp% 算，血量設太大會讓盜賊/法師的數字爆掉
const DUMMY_BASE = {
  name: "訓練假人", level: PLAYER_LEVEL, maxHp: DUMMY_HP,
  def: 20, flatDef: 40, agi: 12, int: 10,
  dodge: 5, hit: 90, critRate: 0, comboChance: 0,
  dmgMin: 0.9, dmgMax: 1, defIgnorePct: 0,
  blockChance: 0, incomingDamageCap: 0, isBoss: false,
};

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
  eq.job_eq = { ...badge, itemId: badge.id, itemName: badge.name, uuid: "b" };
  eq.weapon = { ...weapon, itemId: weapon.id, itemName: weapon.name, uuid: "w", enhanceLevel: ENHANCE };
  for (const slot of ["head_top", "armor", "garment", "shoes"]) {
    const it = await items.findOne({ equipSlot: slot, tier: TIER, itemType: "equipment", weaponType: null });
    if (it) eq[slot] = { ...it, itemId: it.id, itemName: it.name, uuid: slot, enhanceLevel: ENHANCE };
  }
  if (extra.dualDagger) {
    const off = await items.findOne({ weaponType: "offhand_dagger", tier: TIER });
    if (off) eq.shield = { ...off, itemId: off.id, itemName: off.name, uuid: "o", enhanceLevel: ENHANCE };
  } else if (extra.shield) {
    const sh = await items.findOne({ equipSlot: "shield", tier: TIER, weaponType: null });
    if (sh) eq.shield = { ...sh, itemId: sh.id, itemName: sh.name, uuid: "s", enhanceLevel: ENHANCE };
  }
  return eq;
}

(async () => {
  const db = await getMongoDb();
  const rows = [];
  for (const job of T1_JOBS) {
    const [name, , wType, mainStat] = job;
    const eq = await buildEquipment(db, job);
    if (!eq) { rows.push({ name, err: "缺裝備" }); continue; }
    const attrs = buildAttrs(mainStat);
    const pStats = calcPlayerStats(attrs, eq, [], [], {});

    // ① 純輸出：假人不還手（atk 0）
    const dummyPassive = { ...DUMMY_BASE, atk: 0 };
    let sum = 0, roundsToKill = 0, killed = 0;
    for (let i = 0; i < SAMPLES; i++) {
      // 磨血：固定血量的假人，看要幾回合打死（上限 150 回合＝10 場）
      let hpLeft = DUMMY_HP, rounds = 0, dealt = 0;
      for (let b = 0; b < BATTLES && hpLeft > 0; b++) {
        const r = runCombatLoop(pStats, dummyPassive, dummyPassive.name, hpLeft, ROUNDS, {
          playerLevel: PLAYER_LEVEL, equipped: eq, inventory: [], monsterIsBoss: false,
        });
        const d = r.totalDamage || 0;
        dealt += d; hpLeft -= d;
        rounds += (r.roundLogs?.length || ROUNDS);
      }
      sum += Math.min(dealt, DUMMY_HP);
      if (hpLeft <= 0) { killed++; roundsToKill += rounds; }
    }
    const perBattle = sum / SAMPLES / Math.max(1, BATTLES);
    const avgRounds = killed ? roundsToKill / killed : null;
    const killRate = killed / SAMPLES;

    // ② 會還手版：假人攻擊＝Lv35 一般怪水準，看陣亡侵蝕多少輸出
    const dummyActive = { ...DUMMY_BASE, atk: 220 };
    let sum2 = 0, deaths = 0;
    for (let i = 0; i < SAMPLES; i++) {
      let t = 0;
      for (let b = 0; b < BATTLES; b++) {
        const r = runCombatLoop(pStats, dummyActive, dummyActive.name, DUMMY_HP, ROUNDS, {
          playerLevel: PLAYER_LEVEL, equipped: eq, inventory: [], monsterIsBoss: false,
        });
        t += r.totalDamage || 0;
        if (r.outcome === "lose") deaths++;
      }
      sum2 += t;
    }
    rows.push({
      name, wType,
      perBattle, avgRounds, killRate,
      per150: perBattle * BATTLES,
      real150: sum2 / SAMPLES,
      deaths: deaths / SAMPLES,
      atk: pStats.atk, hp: pStats.maxHp,
    });
  }

  const ok = rows.filter((r) => !r.err).sort((a, b) => b.per150 - a.per150);
  const median = ok[Math.floor(ok.length / 2)].per150;

  console.log(`═══ 一轉職業傷害對照（Lv${PLAYER_LEVEL}／${TIER}階整套+${ENHANCE}／同一隻 ${DUMMY_HP.toLocaleString()} 血假人／樣本 ${SAMPLES}）═══\n`);
  console.log("職業".padEnd(10) + "武器".padEnd(11) + "單場均傷".padEnd(12) + "打死要幾回合".padEnd(15) + "150回合內打死率".padEnd(18) + "相對中位");
  console.log("─".repeat(78));
  for (const r of ok) {
    const rel = (r.per150 / median) * 100;
    const flag = rel >= 150 ? " ⚠️過高" : rel <= 60 ? " ⚠️過低" : "";
    console.log(
      r.name.padEnd(10)
      + String(r.wType).padEnd(11)
      + Math.round(r.perBattle).toLocaleString().padEnd(12)
      + (r.avgRounds ? r.avgRounds.toFixed(0) + " 回合" : "打不死").padEnd(15)
      + ((r.killRate * 100).toFixed(0) + "%").padEnd(18)
      + (rel.toFixed(0) + "%") + flag
    );
  }
  console.log("\n中位數 = " + Math.round(median).toLocaleString() + "（相對中位 100%）");
  const top = ok[0], bot = ok[ok.length - 1];
  console.log(`最高 ${top.name} ${Math.round(top.per150).toLocaleString()} ／ 最低 ${bot.name} ${Math.round(bot.per150).toLocaleString()} → 差距 ${(top.per150 / bot.per150).toFixed(1)}×`);
  process.exit(0);
})().catch((e) => { console.error("失敗：", e); process.exit(1); });
