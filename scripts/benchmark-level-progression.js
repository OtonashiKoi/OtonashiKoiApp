require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");

const RUNS = 30;

// 各等級的測試情境
const SCENARIOS = [
  { playerLevel: 3,  zone: "beginner",          tier: "D", totalAttr: 10 },
  { playerLevel: 8,  zone: "normal",            tier: "D", totalAttr: 20 },
  { playerLevel: 10, zone: "mid",               tier: "C", totalAttr: 24 },
  { playerLevel: 20, zone: "ancient_city",      tier: "C", totalAttr: 44 },
  { playerLevel: 30, zone: "ancient_city_deep", tier: "B", totalAttr: 64 },
  { playerLevel: 40, zone: "elite",             tier: "A", totalAttr: 84 },
];

// 10 個職業基本配比（會依 totalAttr 等比例縮放）
const JOB_TEMPLATES = [
  { job: "劍士",     badge: "劍士徽章",     ratio: { str: 40, agi: 25, vit: 20, int: 1, dex: 8, luk: 6 },  weapon: "單手劍", offhand: "盾",   armorFlavor: "鬥紋" },
  { job: "戰士",     badge: "戰士徽章",     ratio: { str: 40, agi: 5,  vit: 40, int: 1, dex: 6, luk: 8 },  weapon: "雙手斧", offhand: null,  armorFlavor: "鬥紋" },
  { job: "矮人戰士", badge: "矮人戰士徽章", ratio: { str: 32, agi: 8,  vit: 40, int: 4, dex: 8, luk: 8 },  weapon: "雙手槌", offhand: null,  armorFlavor: "鬥紋" },
  { job: "盜賊",     badge: "盜賊徽章",     ratio: { str: 14, agi: 38, vit: 5,  int: 1, dex: 34,luk: 8 },  weapon: "匕首",   offhand: "副手匕首", armorFlavor: "迅紋" },
  { job: "弓箭手",   badge: "弓箭手徽章",   ratio: { str: 5,  agi: 30, vit: 14, int: 1, dex: 42,luk: 8 },  weapon: "弓",     offhand: null,  armorFlavor: "迅紋" },
  { job: "法師",     badge: "法師徽章",     ratio: { str: 1,  agi: 14, vit: 22, int: 50,dex: 5, luk: 8 },  weapon: "雙手法杖",offhand: null, armorFlavor: "智紋" },
  { job: "治療師",   badge: "治療師徽章",   ratio: { str: 1,  agi: 7,  vit: 40, int: 40,dex: 5, luk: 7 },  weapon: "單手法杖",offhand: "盾", armorFlavor: "智紋" },
  { job: "軍師",     badge: "軍師徽章",     ratio: { str: 8,  agi: 28, vit: 8,  int: 28,dex: 24,luk: 4 },  weapon: "單手劍", offhand: "盾",   armorFlavor: "智紋" },
  { job: "詩人",     badge: "詩人徽章",     ratio: { str: 3,  agi: 33, vit: 13, int: 1, dex: 33,luk: 17}, weapon: "弓",     offhand: null,  armorFlavor: "迅紋" },
  { job: "結界師",   badge: "結界師徽章",   ratio: { str: 1,  agi: 5,  vit: 40, int: 36,dex: 14,luk: 4 },  weapon: "雙手法杖",offhand: null, armorFlavor: "智紋" },
];

const ARMOR_SLOTS = ["armor", "garment", "shoes", "head_top", "head_mid", "head_low", "accessory_l", "accessory_r"];

// 武器名稱對照 (tier × weapon-type)
const WEAPON_MATERIAL = { D: "木製", C: "鐵製", B: "鋼製", A: "秘銀" };
const WEAPON_TYPE_NAME = {
  "單手劍": "單手劍", "雙手斧": "雙手斧", "雙手槌": "雙手槌",
  "匕首": "匕首", "副手匕首": "短匕(副手)", "弓": "弓",
  "雙手法杖": "雙手法杖", "單手法杖": "單手法杖", "盾": "盾",
};
const ARMOR_NAMES = {
  D: { material: "布", slots: { armor:"衣", garment:"披風", shoes:"鞋", head_top:"帽", head_mid:"護目", head_low:"口罩", accessory_l:"戒指(左)", accessory_r:"戒指(右)" } },
  C: { material: "皮", slots: { armor:"甲", garment:"披風", shoes:"靴", head_top:"帽", head_mid:"護目", head_low:"口罩", accessory_l:"戒指(左)", accessory_r:"戒指(右)" } },
  B: { material: "鐵", slots: { armor:"甲", garment:"披風", shoes:"靴", head_top:"帽", head_mid:"護目", head_low:"口罩", accessory_l:"戒指(左)", accessory_r:"戒指(右)" } },
  A: { material: "秘銀", slots: { armor:"甲", garment:"披風", shoes:"靴", head_top:"帽", head_mid:"護目", head_low:"口罩", accessory_l:"戒指(左)", accessory_r:"戒指(右)" } },
};
// D 階飾品要從 銅戒指 找
const ACCESSORY_TIER_MATERIAL = { D: "銅", C: "鐵", B: "銀", A: "金" };

function scaleAttrs(ratio, total) {
  const sum = Object.values(ratio).reduce((a, b) => a + b, 0);
  const result = {};
  let allocated = 0;
  const keys = Object.keys(ratio);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (i === keys.length - 1) {
      result[k] = Math.max(1, total - allocated);
    } else {
      const v = Math.max(1, Math.round((ratio[k] / sum) * total));
      result[k] = v;
      allocated += v;
    }
  }
  return result;
}

function buildEquipped(build, tier, items, includeBadge) {
  const find = (name, tierFilter) => items.find((it) => it.name === name && (tierFilter == null || it.tier === tierFilter));
  const findBySlot = (slot, tierFilter, weaponType = null) => items.find((it) =>
    it.equipSlot === slot && (tierFilter == null || it.tier === tierFilter) && (weaponType == null || it.weaponType === weaponType));

  const equipped = {};
  const mat = WEAPON_MATERIAL[tier] || "鋼製";

  // 武器
  const wName = `${mat}${WEAPON_TYPE_NAME[build.weapon] || build.weapon}`;
  const w = find(wName, tier) || findBySlot("weapon", tier);
  if (w) equipped.weapon = { ...w, itemId: w.id, itemName: w.name };

  // 副手（盾或副手武器）
  if (build.offhand === "盾") {
    const sName = `${mat}盾`;
    const s = find(sName, tier);
    if (s) equipped.shield = { ...s, itemId: s.id, itemName: s.name };
  } else if (build.offhand === "副手匕首") {
    const sName = `${mat}${WEAPON_TYPE_NAME[build.offhand]}`;
    const s = find(sName, tier);
    if (s) equipped.shield = { ...s, itemId: s.id, itemName: s.name };
  }

  // 護甲套裝
  for (const slot of ARMOR_SLOTS) {
    let p = null;
    if (slot === "accessory_l" || slot === "accessory_r") {
      const accMat = ACCESSORY_TIER_MATERIAL[tier] || "銀";
      p = find(`${build.armorFlavor}${accMat}戒指(${slot === "accessory_l" ? "左" : "右"})`, tier);
    } else {
      const armorMat = ARMOR_NAMES[tier]?.material || "鐵";
      const suffix = ARMOR_NAMES[tier]?.slots?.[slot] || "";
      p = find(`${build.armorFlavor}${armorMat}${suffix}`, tier)
       || find(`${armorMat}${suffix}`, tier);
    }
    if (!p) p = findBySlot(slot, tier);
    if (p) equipped[slot] = { ...p, itemId: p.id, itemName: p.name };
  }

  // 職業徽章 (Lv.10+)
  if (includeBadge) {
    const b = find(build.badge, null);
    if (b) equipped.job_eq = { ...b, itemId: b.id, itemName: b.name };
  }
  return equipped;
}

function buildMonsterCalc(m) {
  const level = Math.max(1, m.level || 1);
  const intStat = m.int || 0;
  const vit = m.vit || 0;
  return {
    maxHp: m.maxHp || (level * 800 + vit * 200),
    atk: (m.str || 1) * 3,
    def: Math.min(75, Math.max(0, Number(m.def) || 0)),
    flatDef: (typeof m.flatDef === 'number') ? Math.max(0, m.flatDef) : level + vit,
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

async function main() {
  const db = await getMongoDb();
  const items = await db.collection("items").find({}).toArray();
  const allMonsters = (await db.collection("monsters").find({}).toArray())
    .filter((m) => !String(m._id || "").startsWith("monsterState:"))
    .filter((m) => m.enabled !== false);

  for (const sc of SCENARIOS) {
    const monsters = allMonsters.filter((m) => m.zone === sc.zone).sort((a, b) => a.level - b.level);
    const includeBadge = sc.playerLevel >= 10;
    console.log(`\n${"═".repeat(110)}`);
    console.log(`【Lv.${sc.playerLevel}】vs ${sc.zone}（${sc.tier} 階裝備${includeBadge ? "+ 職業徽章" : "（未解職業）"}, ${RUNS} 場）`);
    console.log("─".repeat(110));
    console.log(["職業".padEnd(8), "勝率", "回合", "DPR", "怪DPR", "代表怪", "BOSS場數"].join("  "));
    console.log("─".repeat(110));

    for (const jt of JOB_TEMPLATES) {
      const attrs = scaleAttrs(jt.ratio, sc.totalAttr);
      const equipped = buildEquipped(jt, sc.tier, items, includeBadge);
      const ps = calcPlayerStats(attrs, equipped, [], [], {});

      let totalWins = 0, totalRounds = 0, totalMy = 0, totalMon = 0;
      let bossWins = 0, bossRounds = 0, bossMy = 0;
      let bossMonster = monsters.find((m) => m.isBoss);
      let bossEstFights = "-";
      let firstMonsterStats = null;

      for (const m of monsters) {
        const mCalc = buildMonsterCalc(m);
        if (!firstMonsterStats) firstMonsterStats = { name: m.name, hp: mCalc.maxHp };
        for (let i = 0; i < RUNS; i++) {
          const r = runCombatLoop(ps, mCalc, m.name, mCalc.maxHp, 15, {
            playerLevel: sc.playerLevel,
            equipped,
            inventory: [],
            monsterIsBoss: Boolean(m.isBoss),
          });
          if (r.outcome === "win") totalWins++;
          const rc = r.roundLogs?.length || 0;
          totalRounds += rc;
          totalMy += r.totalDamage || 0;
          totalMon += Math.max(0, ps.maxHp - (r.finalPlayerHp ?? 0));
          if (m.isBoss) {
            if (r.outcome === "win") bossWins++;
            bossRounds += rc;
            bossMy += r.totalDamage || 0;
          }
        }
      }
      const wr = ((totalWins / (RUNS * monsters.length)) * 100).toFixed(0);
      const ar = (totalRounds / (RUNS * monsters.length)).toFixed(1);
      const myDpr = (totalMy / totalRounds || 0).toFixed(0);
      const mDpr = (totalMon / totalRounds || 0).toFixed(0);
      // BOSS 估算場數
      if (bossMonster) {
        const dprPerFight = bossMy / RUNS;
        if (dprPerFight > 0) {
          bossEstFights = Math.ceil(bossMonster.maxHp / dprPerFight) + " 場";
        }
      }

      console.log([
        jt.job.padEnd(8),
        `${wr}%`.padEnd(4),
        ar.padEnd(4),
        myDpr.padEnd(4),
        mDpr.padEnd(4),
        `${firstMonsterStats?.name || "?"}(${firstMonsterStats?.hp || "?"})`.padEnd(20),
        bossEstFights,
      ].join("  "));
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
