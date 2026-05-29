require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");

const RUNS = 200;            // 多跑點看自殘率
const PLAYER_LEVEL = 30;
const TARGET_MONSTER = "黑焰巫師"; // 古城深處 Lv.27 — 中等難度，會撐到 15 回合

// 跟前一個 bench 同樣的職業配置
const JOB_BUILDS = [
  { job: "劍士", badge: "劍士徽章", attrs: { str: 28, agi: 18, vit: 12, int: 1, dex: 3, luk: 2 }, weapon: "鋼製單手劍", offhand: "鋼盾", armorFlavor: "鬥紋" },
  { job: "戰士", badge: "戰士徽章", attrs: { str: 28, agi: 5, vit: 25, int: 1, dex: 3, luk: 2 }, weapon: "鋼製雙手斧", offhand: null, armorFlavor: "鬥紋" },
  { job: "矮人戰士", badge: "矮人戰士徽章", attrs: { str: 22, agi: 8, vit: 25, int: 3, dex: 4, luk: 2 }, weapon: "鋼製雙手槌", offhand: null, armorFlavor: "鬥紋" },
  { job: "盜賊", badge: "盜賊徽章", attrs: { str: 10, agi: 25, vit: 5, int: 1, dex: 21, luk: 2 }, weapon: "鋼製匕首", offhand: "鋼製短匕(副手)", armorFlavor: "迅紋" },
  { job: "弓箭手", badge: "弓箭手徽章", attrs: { str: 3, agi: 20, vit: 10, int: 1, dex: 28, luk: 2 }, weapon: "鋼製弓", offhand: null, armorFlavor: "迅紋" },
  { job: "法師", badge: "法師徽章", attrs: { str: 1, agi: 10, vit: 15, int: 33, dex: 3, luk: 2 }, weapon: "鋼製雙手法杖", offhand: null, armorFlavor: "智紋" },
  { job: "治療師", badge: "治療師徽章", attrs: { str: 1, agi: 5, vit: 25, int: 28, dex: 3, luk: 2 }, weapon: "鋼製單手法杖", offhand: "鋼盾", armorFlavor: "智紋" },
  { job: "軍師", badge: "軍師徽章", attrs: { str: 5, agi: 18, vit: 5, int: 18, dex: 16, luk: 2 }, weapon: "鋼製單手劍", offhand: "鋼盾", armorFlavor: "智紋" },
  { job: "詩人", badge: "詩人徽章", attrs: { str: 2, agi: 22, vit: 8, int: 1, dex: 22, luk: 9 }, weapon: "鋼製弓", offhand: null, armorFlavor: "迅紋" },
  { job: "結界師", badge: "結界師徽章", attrs: { str: 1, agi: 3, vit: 25, int: 24, dex: 9, luk: 2 }, weapon: "鋼製雙手法杖", offhand: null, armorFlavor: "智紋" },
];

const ARMOR_SLOTS = ["armor", "garment", "shoes", "head_top", "head_mid", "head_low", "accessory_l", "accessory_r"];
function suffixFor(slot) { return ({armor:"甲",garment:"披風",shoes:"靴",head_top:"帽",head_mid:"護目",head_low:"口罩",accessory_l:"戒指(左)",accessory_r:"戒指(右)"})[slot] || ""; }

function buildEquipped(build, items) {
  const find = (name, tier) => items.find((it) => it.name === name && (tier === null || it.tier === tier));
  const findBySlot = (slot, tier) => items.find((it) => it.equipSlot === slot && (tier === null || it.tier === tier));
  const equipped = {};
  const w = find(build.weapon, "B"); if (w) equipped.weapon = { ...w, itemId: w.id, itemName: w.name };
  if (build.offhand) { const o = find(build.offhand, "B"); if (o) equipped.shield = { ...o, itemId: o.id, itemName: o.name }; }
  for (const slot of ARMOR_SLOTS) {
    let p = find(`${build.armorFlavor}鐵${suffixFor(slot)}`, "B")
         || find(`${build.armorFlavor}銀${suffixFor(slot)}`, "B")
         || findBySlot(slot, "B");
    if (p) equipped[slot] = { ...p, itemId: p.id, itemName: p.name };
  }
  const b = find(build.badge, null); if (b) equipped.job_eq = { ...b, itemId: b.id, itemName: b.name };
  return equipped;
}

function buildMonsterCalc(m) {
  const level = Math.max(1, m.level || 1);
  const intStat = m.int || 0;
  return {
    maxHp: m.maxHp || 100,
    atk: (m.str || 1) * 3,
    def: Math.min(75, Math.max(0, Number(m.def) || 0)),
    flatDef: (typeof m.flatDef === 'number') ? Math.max(0, m.flatDef) : level * 1,
    level, agi: m.agi || 1, int: intStat, dex: m.dex || 1, luk: m.luk || 0,
    dodge: Math.min(50, (m.agi || 1) * 0.5),
    hit: Math.min(100, 80 + (m.dex || 1)),
    critRate: Math.min(100, Math.round((m.luk || 0) * 0.3)),
    comboChance: Math.min(80, Math.round(3 + (m.agi || 1) * 0.5)),
    defIgnorePct: m.defIgnorePct || 0,
    isBoss: Boolean(m.isBoss),
    dmgMin: Math.min(1.0, 0.7 + intStat * 0.01),
    dmgMax: 1.0,
  };
}

function summarizeLogs(roundLogs) {
  const stats = { critFail: 0, fail: 0, great: 0, perfect: 0, crushed: 0, reduce: 0, graze: 0, combo: 0, monsterCritFail: 0, monsterFail: 0, monsterGreat: 0, monsterPerfect: 0 };
  const joined = roundLogs.join("\n");
  stats.critFail = (joined.match(/💥 \*\*大失敗\*\*！你揮拳/g) || []).length;
  stats.fail = (joined.match(/❌ \*\*失敗\*\*！你手滑/g) || []).length;
  stats.great = (joined.match(/⚡\*\*大成功\*\*！/g) || []).length;
  stats.perfect = (joined.match(/🌟\*\*完美\*\*！/g) || []).length;
  stats.crushed = (joined.match(/💢被爆打/g) || []).length;
  stats.reduce = (joined.match(/🛡️減傷/g) || []).length;
  stats.graze = (joined.match(/🌬️擦傷/g) || []).length;
  stats.combo = (joined.match(/連擊！再造成/g) || []).length;
  stats.monsterCritFail = (joined.match(/💥 \*\*.*大失敗\*\*！自亂招式/g) || []).length;
  stats.monsterFail = (joined.match(/❌ \*\*.*失敗\*\*！揮空了！/g) || []).length;
  stats.monsterGreat = (joined.match(/⚡\*\*怪物大成功\*\*！/g) || []).length;
  stats.monsterPerfect = (joined.match(/🌟\*\*怪物完美\*\*！/g) || []).length;
  return stats;
}

async function main() {
  const db = await getMongoDb();
  const items = await db.collection("items").find({}).toArray();
  const monster = await db.collection("monsters").findOne({ name: TARGET_MONSTER });
  if (!monster) { console.error(`找不到 ${TARGET_MONSTER}`); process.exit(1); }
  const mCalc = buildMonsterCalc(monster);

  console.log(`\n═══ 各職業 ${RUNS} 場對 ${TARGET_MONSTER} (Lv.${monster.level}, HP ${monster.maxHp}) ═══\n`);
  console.log("─".repeat(120));
  console.log(["職業".padEnd(8), "勝率", "回合", "自殘次", "自殘總", "我大失敗", "我失敗", "我大成功", "我完美", "我連擊", "怪大成功", "怪完美"].join("  "));
  console.log("─".repeat(120));

  const sampleLogs = {};

  for (const build of JOB_BUILDS) {
    const equipped = buildEquipped(build, items);
    const ps = calcPlayerStats(build.attrs, equipped, [], [], {});
    let wins = 0, totalRounds = 0, totalSelfDmg = 0, selfDmgCount = 0;
    let agg = { critFail: 0, fail: 0, great: 0, perfect: 0, crushed: 0, reduce: 0, graze: 0, combo: 0, monsterCritFail: 0, monsterFail: 0, monsterGreat: 0, monsterPerfect: 0 };
    let sample = null;

    for (let i = 0; i < RUNS; i++) {
      const r = runCombatLoop(ps, mCalc, monster.name, mCalc.maxHp, 15, {
        playerLevel: PLAYER_LEVEL,
        equipped,
        inventory: [],
        monsterIsBoss: Boolean(monster.isBoss),
      });
      if (r.outcome === "win") wins++;
      totalRounds += r.roundLogs?.length || 0;
      const s = summarizeLogs(r.roundLogs || []);
      for (const k of Object.keys(agg)) agg[k] += s[k];
      // 估算自殘總傷
      for (const line of r.roundLogs || []) {
        const m = line.match(/💥 \*\*大失敗\*\*！.*?\*\*(\d+)\*\* 點/);
        if (m) { selfDmgCount++; totalSelfDmg += Number(m[1]); }
      }
      if (!sample && r.outcome !== "win") sample = r.roundLogs;
    }
    sampleLogs[build.job] = sample;

    console.log([
      build.job.padEnd(8),
      `${((wins / RUNS) * 100).toFixed(0)}%`.padEnd(4),
      (totalRounds / RUNS).toFixed(1).padEnd(4),
      String(selfDmgCount).padEnd(5),
      String(totalSelfDmg).padEnd(5),
      String(agg.critFail).padEnd(8),
      String(agg.fail).padEnd(7),
      String(agg.great).padEnd(8),
      String(agg.perfect).padEnd(6),
      String(agg.combo).padEnd(6),
      String(agg.monsterGreat).padEnd(8),
      String(agg.monsterPerfect).padEnd(8),
    ].join("  "));
  }

  console.log("\n═══ 範例 15 回合戰報（戰士 vs 黑焰巫師）═══\n");
  if (sampleLogs["戰士"]) {
    for (let i = 0; i < Math.min(sampleLogs["戰士"].length, 15); i++) {
      console.log(`【第 ${i + 1} 回合】`);
      console.log(sampleLogs["戰士"][i].replace(/^.*第 \d+ 回合.*$/m, "").replace(/\*\*/g, "").trim());
      console.log("");
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
