"use strict";
/**
 * 盜靈 vs 影舞者：**連鎖模擬**（修正對照組被低估的問題）。
 *
 * 為什麼要有這支：
 *   影舞者的連擊氣條是「跨場沿用」（options.shadowGaugeGrids 進 / result.shadowGauge 出）。
 *   一般模擬每場獨立、氣條都從 0 開始，等於永遠只能在第 5 回合後才滿一次 →
 *   **嚴重低估影舞者**。真實玩家是連續刷怪、氣條帶著走的。
 *   這支把每場的 result.shadowGauge 餵給下一場，量的是真正的穩態。
 *
 * 用法：node scripts/sim-spiritthief-chain.js [zoneKey] [aboveGreatMult]
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { createServiceContext } = require("../src/services/createServiceContext");
const { createWorldBossSim } = require("./lib/simWorldBoss");

const RUNS = Number(process.env.RUNS) || 1000;
const ZONE = process.argv[2] || "dragon_king_lair";
const MULT_OVERRIDE = Number(process.argv[3]) || null;
const BASE_PLAYER = "386854676433207318";
const STATS = { str: 0, agi: 7, vit: 0, int: 0, dex: 3, luk: 2 };

async function main() {
  const db = await getMongoDb();
  const sc = createServiceContext();
  const items = db.collection("items");
  const sim = await createWorldBossSim(sc, db, ZONE);
  const base = await db.collection("progress").findOne({ playerId: BASE_PLAYER });
  const ja = require("../src/shared/jobAdvancement");
  if (MULT_OVERRIDE) {
    ja.T2_BRANCHES.rogue[1].deftHands.aboveGreatMult = MULT_OVERRIDE;
    console.log(`（覆寫巧手 aboveGreatMult = ${MULT_OVERRIDE}）`);
  }

  const shadowBadge = await items.findOne({ id: "job_shadowdancer_t2_v1" });
  const weapon = await items.findOne({ weaponType: "dagger", tier: "S" });
  const offhand = await items.findOne({ weaponType: "offhand_dagger", tier: "A" });
  const thiefBadge = { ...shadowBadge, id: "job_spiritthief_t2_v1", name: "盜靈徽章", equipStats: STATS };

  function buildEq(badge) {
    const eq = JSON.parse(JSON.stringify(base.equipment || {}));
    eq.job_eq = { ...badge, itemId: badge.id, itemName: badge.name, uuid: "sim-badge" };
    eq.weapon = { ...weapon, itemId: weapon.id, itemName: weapon.name, uuid: "sim-w", enhanceLevel: 0 };
    eq.shield = { ...offhand, itemId: offhand.id, itemName: offhand.name, uuid: "sim-o", enhanceLevel: 0 };
    delete eq.offhand;
    return eq;
  }

  const attrs = { str: 10, agi: 40, vit: 24, int: 10, dex: 10, luk: 10 };

  /** 連鎖跑：把上一場的氣條帶進下一場 */
  function chain(badge, extraBase = {}) {
    const eq = buildEq(badge);
    const progress = { ...base, attributes: attrs, equipment: eq };
    let grids = 0;
    let sumDmg = 0, sumRounds = 0, deaths = 0, bursts = 0, steals = 0;
    for (let i = 0; i < RUNS; i++) {
      const r = sim.single(progress, {
        equipment: eq,
        extraOptions: { ...extraBase, shadowGaugeGrids: grids },
      });
      sumDmg += r.totalDamage || 0;
      sumRounds += (r.nextRound || 2) - 1;
      if (r.outcome === "lose") deaths++;
      if (r.combatStats?.stealTriggered) steals++;
      const next = r.shadowGauge;
      if (typeof next === "number") { if (next >= 5) bursts++; grids = next; }
    }
    return {
      avgDmg: sumDmg / RUNS, avgRounds: sumRounds / RUNS,
      deathRate: deaths / RUNS, burstRate: bursts / RUNS, stealRate: steals / RUNS,
    };
  }

  console.log(`\n【盜靈 vs 影舞者・連鎖模擬】${sim.info}`);
  console.log(`每組 ${RUNS} 場「連續」戰鬥（氣條跨場沿用）\n`);

  const rows = [
    ["影舞者（氣條沿用・真穩態）", chain(shadowBadge)],
    ["影舞者（每場歸零・舊算法）", (() => {
      const eq = buildEq(shadowBadge);
      const p = { ...base, attributes: attrs, equipment: eq };
      const r = sim.run(p, { runs: RUNS, equipment: eq });
      return { avgDmg: r.avgDmg, avgRounds: r.avgRounds, deathRate: r.deathRate, burstRate: null, stealRate: 0 };
    })()],
    ["盜靈（穩態・得手已用）", chain(thiefBadge, { stealUsed: true })],
    ["盜靈（對新怪第一場）", chain(thiefBadge, { stealUsed: false })],
  ];

  const baseDmg = rows[0][1].avgDmg;
  console.log("情境                          存活  陣亡%      均傷   相對影舞者   滿氣場%  得手%");
  console.log("─".repeat(84));
  for (const [label, r] of rows) {
    console.log(
      `${label.padEnd(28)} ${r.avgRounds.toFixed(1).padStart(5)} ${(r.deathRate * 100).toFixed(0).padStart(5)}% ` +
      `${Math.round(r.avgDmg).toLocaleString().padStart(9)}   ${(r.avgDmg / baseDmg).toFixed(3)}x` +
      `${r.burstRate === null ? "        —" : ("  " + (r.burstRate * 100).toFixed(0) + "%").padStart(9)}` +
      `${("  " + (r.stealRate * 100).toFixed(0) + "%").padStart(7)}`
    );
  }
  console.log("─".repeat(84));
  console.log(`巧手 aboveGreatMult = ${ja.T2_BRANCHES.rogue[1].deftHands.aboveGreatMult}｜目標：盜靈穩態落在影舞者真穩態的 0.95~1.00x\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
