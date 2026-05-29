require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");

const RUNS = 50;
const PLAYER_LEVEL = 30;

// 10 個職業設定（屬性點分配 + 武器 + 副手 + 套裝偏好 + 徽章）
// 屬性點 30 等 = 1+ 29×2 = 6+58 = 64 (差不多，視 progression.js 而定)
// 我給每個職業 64 點，依職業主屬性分配
const JOB_BUILDS = [
  {
    job: "劍士",
    badge: "劍士徽章",
    attrs: { str: 28, agi: 18, vit: 12, int: 1, dex: 3, luk: 2 },
    weapon: "鋼製單手劍",
    offhand: "鋼盾",
    armorFlavor: "鬥紋",
  },
  {
    job: "戰士",
    badge: "戰士徽章",
    attrs: { str: 28, agi: 5, vit: 25, int: 1, dex: 3, luk: 2 },
    weapon: "鋼製雙手斧",
    offhand: null,
    armorFlavor: "鬥紋",
  },
  {
    job: "矮人戰士",
    badge: "矮人戰士徽章",
    attrs: { str: 22, agi: 8, vit: 25, int: 3, dex: 4, luk: 2 },
    weapon: "鋼製雙手槌",
    offhand: null,
    armorFlavor: "鬥紋",
  },
  {
    job: "盜賊",
    badge: "盜賊徽章",
    attrs: { str: 10, agi: 25, vit: 5, int: 1, dex: 21, luk: 2 },
    weapon: "鋼製匕首",
    offhand: "鋼製短匕(副手)",
    armorFlavor: "迅紋",
  },
  {
    job: "弓箭手",
    badge: "弓箭手徽章",
    attrs: { str: 3, agi: 20, vit: 10, int: 1, dex: 28, luk: 2 },
    weapon: "鋼製弓",
    offhand: null,
    armorFlavor: "迅紋",
  },
  {
    job: "法師",
    badge: "法師徽章",
    attrs: { str: 1, agi: 10, vit: 15, int: 33, dex: 3, luk: 2 },
    weapon: "鋼製雙手法杖",
    offhand: null,
    armorFlavor: "智紋",
  },
  {
    job: "治療師",
    badge: "治療師徽章",
    attrs: { str: 1, agi: 5, vit: 25, int: 28, dex: 3, luk: 2 },
    weapon: "鋼製單手法杖",
    offhand: "鋼盾",
    armorFlavor: "智紋",
  },
  {
    job: "軍師",
    badge: "軍師徽章",
    attrs: { str: 5, agi: 18, vit: 5, int: 18, dex: 16, luk: 2 },
    weapon: "鋼製單手劍",
    offhand: "鋼盾",
    armorFlavor: "智紋",
  },
  {
    job: "詩人",
    badge: "詩人徽章",
    attrs: { str: 2, agi: 22, vit: 8, int: 1, dex: 22, luk: 9 },
    weapon: "鋼製弓",
    offhand: null,
    armorFlavor: "迅紋",
  },
  {
    job: "結界師",
    badge: "結界師徽章",
    attrs: { str: 1, agi: 3, vit: 25, int: 24, dex: 9, luk: 2 },
    weapon: "鋼製雙手法杖",
    offhand: null,
    armorFlavor: "智紋",
  },
];

const ARMOR_SLOTS = ["armor", "garment", "shoes", "head_top", "head_mid", "head_low", "accessory_l", "accessory_r"];

function buildEquipped(build, itemsByNameTier) {
  const equipped = {};
  // 武器
  const weapon = itemsByNameTier(build.weapon, "B");
  if (weapon) equipped.weapon = { ...weapon, itemId: weapon.id, itemName: weapon.name };
  // 副手
  if (build.offhand) {
    const off = itemsByNameTier(build.offhand, "B");
    if (off) equipped.shield = { ...off, itemId: off.id, itemName: off.name };
  }
  // 護甲套裝（依 armorFlavor 找對應風格）
  for (const slot of ARMOR_SLOTS) {
    let pick = itemsByNameTier(`${build.armorFlavor}鐵${suffixFor(slot)}`, "B")
            || itemsByNameTier(`${build.armorFlavor}鐵${altSuffixFor(slot)}`, "B")
            || itemsByNameTier(`${build.armorFlavor}銀${suffixFor(slot)}`, "B");
    if (!pick) {
      // fallback：任何 B 階符合槽位的
      pick = itemsByNameTier(null, "B", slot);
    }
    if (pick) equipped[slot] = { ...pick, itemId: pick.id, itemName: pick.name };
  }
  // 職業徽章
  const badge = itemsByNameTier(build.badge, null);
  if (badge) equipped.job_eq = { ...badge, itemId: badge.id, itemName: badge.name };
  return equipped;
}

function suffixFor(slot) {
  return ({
    armor: "甲", garment: "披風", shoes: "靴", head_top: "帽", head_mid: "護目", head_low: "口罩",
    accessory_l: "戒指(左)", accessory_r: "戒指(右)",
  })[slot] || "";
}
function altSuffixFor(slot) {
  return ({
    armor: "袍", garment: "披肩", head_top: "盔", head_mid: "鏡片", head_low: "面甲", head_low2: "面罩", head_low3: "口飾",
  })[slot] || "";
}

function buildMonsterCalc(m) {
  const level = Math.max(1, m.level || 1);
  const str = m.str || 1, agi = m.agi || 1, vit = m.vit || 1, dex = m.dex || 1;
  const intStat = m.int || 0;
  return {
    maxHp: m.maxHp || 100,
    atk: str * 3,
    def: Math.min(75, Math.max(0, Number(m.def) || 0)),
    flatDef: (typeof m.flatDef === 'number') ? Math.max(0, m.flatDef) : (level * 1) + (vit * 2),
    level,
    agi,
    int: intStat,
    dex,
    luk: m.luk || 0,
    dodge: Math.min(50, agi * 0.5),
    hit: Math.min(100, 80 + dex),
    critRate: Math.min(100, Math.round((m.luk || 0) * 0.3)),
    comboChance: Math.min(80, Math.round(3 + agi * 0.5)),
    defIgnorePct: m.defIgnorePct || 0,
    isBoss: Boolean(m.isBoss),
    dmgMin: Math.min(1.0, 0.7 + intStat * 0.01),
    dmgMax: 1.0,
  };
}

async function main() {
  const db = await getMongoDb();
  const items = await db.collection("items").find({}).toArray();
  const monsters = (await db.collection("monsters").find({ zone: "ancient_city" }).sort({ level: 1, seq: 1 }).toArray())
    .filter((m) => m.enabled !== false);

  const itemsByNameTier = (name, tier, slot = null) => {
    if (name) return items.find((it) => it.name === name && (tier === null || it.tier === tier));
    if (slot) return items.find((it) => it.equipSlot === slot && (tier === null || it.tier === tier));
    return null;
  };

  console.log(`\n═══ Lv.${PLAYER_LEVEL} 全職業 × 古城 ${monsters.length} 隻怪 × ${RUNS} 場 ═══\n`);

  // 印玩家 stats 摘要
  console.log("職業預覽：");
  console.log("─".repeat(110));
  const playerStats = [];
  for (const build of JOB_BUILDS) {
    const equipped = buildEquipped(build, itemsByNameTier);
    const ps = calcPlayerStats(build.attrs, equipped, [], [], {});
    playerStats.push({ build, equipped, ps });
    console.log(
      build.job.padEnd(8),
      ` HP=${String(ps.maxHp).padStart(4)} ATK=${String(ps.atk).padStart(4)} flatDef=${String(ps.flatDef).padStart(3)} pctDef=${String(ps.def).padStart(3)}%`,
      ` DODGE=${String(Math.round(ps.dodge)).padStart(3)}% HIT=${String(Math.round(ps.hit)).padStart(3)}% CRIT=${String(Math.round(ps.crit)).padStart(3)}% COMBO=${String(Math.round(ps.combo)).padStart(3)}%`,
    );
  }
  console.log("");

  // 跑分
  for (const { build, equipped, ps } of playerStats) {
    console.log(`\n══ ${build.job} ══`);
    console.log("怪物".padEnd(14), "Lv ", "勝率 ", "回合 ", "DPR  ", "怪DPR", "結果");
    console.log("─".repeat(80));
    let totalWins = 0, totalRounds = 0, totalMy = 0, totalMon = 0;
    for (const m of monsters) {
      const mCalc = buildMonsterCalc(m);
      let wins = 0, rounds = 0, my = 0, mon = 0;
      for (let i = 0; i < RUNS; i++) {
        const r = runCombatLoop(ps, mCalc, m.name, mCalc.maxHp, 15, {
          playerLevel: PLAYER_LEVEL,
          equipped,
          inventory: [],
          monsterIsBoss: Boolean(m.isBoss),
        });
        if (r.outcome === "win") wins++;
        const rc = r.roundLogs?.length || 0;
        rounds += rc;
        my += r.totalDamage || 0;
        mon += Math.max(0, ps.maxHp - (r.finalPlayerHp ?? 0));
      }
      const wr = ((wins / RUNS) * 100).toFixed(0);
      const ar = (rounds / RUNS).toFixed(1);
      const myDpr = (my / rounds || 0).toFixed(0);
      const mDpr = (mon / rounds || 0).toFixed(0);
      const v = wins === RUNS ? "✅" : wins === 0 ? "💀" : wins >= RUNS * 0.8 ? "👍" : wins >= RUNS * 0.4 ? "⚖️" : "⚠️";
      console.log(
        m.name.padEnd(14),
        String(m.level).padEnd(3),
        `${wr}%`.padEnd(5),
        ar.padEnd(5),
        myDpr.padEnd(5),
        mDpr.padEnd(5),
        v,
      );
      totalWins += wins; totalRounds += rounds; totalMy += my; totalMon += mon;
    }
    const overallWR = ((totalWins / (RUNS * monsters.length)) * 100).toFixed(0);
    const overallDpr = (totalMy / totalRounds || 0).toFixed(0);
    const overallMDpr = (totalMon / totalRounds || 0).toFixed(0);
    console.log("─".repeat(80));
    console.log(`整體：勝率 ${overallWR}%  我方DPR ${overallDpr}  怪DPR ${overallMDpr}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
