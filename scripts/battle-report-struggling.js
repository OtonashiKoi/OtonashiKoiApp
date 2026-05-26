"use strict";
/**
 * 印出幾位戰績慘的玩家對自己區內代表怪的完整戰報。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");

const TARGETS = [
  { name: "BrooF",    zone: "normal",   vsMonster: "小史" },        // Lv.4 vs Lv.4
  { name: "餅乾oao",  zone: "normal",   vsMonster: "哥布" },        // Lv.5 vs Lv.5
  { name: "registe",  zone: "normal",   vsMonster: "哥布" },
  { name: "8652648",  zone: "normal",   vsMonster: "哥布" },
  { name: "boris.g",  zone: "normal",   vsMonster: "石頭" },        // Lv.6 vs Lv.6
];

function buildMonsterCalc(m) {
  const level = Math.max(1, m.level || 1);
  const intStat = m.int || 0;
  const vit = m.vit || 0;
  return {
    maxHp: m.maxHp || (level * 800 + vit * 200),
    atk: (m.str || 1) * 3,
    def: Math.min(75, Math.max(0, Number(m.def) || 0)),
    flatDef: (typeof m.flatDef === "number") ? Math.max(0, m.flatDef) : level + vit,
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
  const ms = (await db.collection("monsters").find({}).toArray())
    .filter(x => !String(x._id || "").startsWith("monsterState:"));

  for (const t of TARGETS) {
    // 用 displayName 模糊比對
    const players = await db.collection("players")
      .find({ $or: [{ displayName: { $regex: t.name } }, { name: { $regex: t.name } }] })
      .toArray();
    const player = players[0];
    if (!player) { console.log(`找不到玩家：${t.name}`); continue; }
    const prog = await db.collection("progress").findOne({ playerId: player.discordId });
    if (!prog) { console.log(`沒 progress：${t.name}`); continue; }

    const monster = ms.find(x => x.zone === t.zone && x.name === t.vsMonster);
    if (!monster) { console.log(`找不到怪：${t.vsMonster}`); continue; }

    const equipped = prog.equipment || {};
    const ps = calcPlayerStats(prog.attributes || {}, equipped, prog.activeEffects || [], prog.inventory || [], { pkRating: prog.pkRating });
    const mCalc = buildMonsterCalc(monster);

    console.log("\n" + "═".repeat(100));
    console.log(`【${player.displayName || player.name}】Lv.${prog.level} vs ${monster.name} (Lv.${monster.level}, HP=${mCalc.maxHp})`);
    console.log("─".repeat(100));
    console.log(`玩家屬性  HP=${ps.maxHp} ATK=${ps.atk} DEF=${ps.def}(flat ${ps.flatDef||0}) AGI=${ps.agi||0} DEX=${ps.dex||0} LUK=${ps.luk||0}`);
    console.log(`        命中=${ps.hit||0} 迴避=${ps.dodge||0} 暴擊=${ps.critRate||0}% 連擊=${ps.comboChance||0}%`);
    const eqList = Object.entries(equipped).filter(([,v])=>v).map(([k,v])=>`${k}=${v.itemName}(${v.tier})`).join(", ");
    console.log(`裝備     ${eqList || "（無）"}`);
    console.log(`怪物屬性  HP=${mCalc.maxHp} ATK=${mCalc.atk} DEF=${mCalc.def}(flat ${mCalc.flatDef}) AGI=${mCalc.agi} DEX=${mCalc.dex}`);
    console.log(`        命中=${mCalc.hit} 迴避=${mCalc.dodge} 暴擊=${mCalc.critRate}%`);
    console.log("─".repeat(100));

    // 跑一場完整戰鬥
    const r = runCombatLoop(ps, mCalc, monster.name, mCalc.maxHp, 15, {
      playerLevel: prog.level,
      equipped,
      inventory: prog.inventory || [],
      monsterIsBoss: false,
    });

    (r.roundLogs || []).forEach((line, i) => {
      console.log(`[R${i+1}] ${line}`);
    });
    console.log("─".repeat(100));
    console.log(`結果：${r.outcome.toUpperCase()}｜總傷害 ${r.totalDamage}｜怪物剩 HP ${r.finalMonsterHp ?? "?"}｜我剩 HP ${r.finalPlayerHp ?? "?"}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
