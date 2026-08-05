"use strict";
/**
 * 全職業強度對照表 —— **真實頂配版**。
 *
 * 與 balance-job-matrix.js（標準化配裝）的差異：
 *   標準化版把防具屬性抹平，會毀掉「靠閃避活」職業的生存（盜賊實測 3.5 回合 vs 真實 14 回合），
 *   對 AGI 系系統性不利。這一版改用**每個職業的真實玩家頂配**：
 *   - 一轉：撈所有裝著該徽章的玩家 → 各跑 100 場挑出最強者當代表 → 代表跑 300 場
 *   - 二轉：拿對應一轉代表的裝備換上二轉徽章（武器系相同，裝備天然合身）
 *   - 沒有真實玩家的職業：用全服最強玩家的防具＋該職業 S 階武器代配（表上標記）
 *
 * 兩張表要一起看：標準化版看「職業機制本身」，這版看「真實環境的實際強度」。
 * 用法：node scripts/balance-job-matrix-real.js [zoneKey]
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { createServiceContext } = require("../src/services/createServiceContext");
const { createWorldBossSim } = require("./lib/simWorldBoss");

const ZONE = process.argv[2] || "dragon_king_lair";
const PICK_RUNS = 100;   // 挑代表
const FINAL_RUNS = 300;  // 正式測

const T1_JOBS = [
  ["劍士", "job_swordsman_v1"],
  ["戰士", "job_warrior_v1"],
  ["矮人戰士", "job_dwarf_warrior_v1"],
  ["盜賊", "job_rogue_v1"],
  ["法師", "job_mage_v1"],
  ["治療師", "job_healer_v1"],
  ["弓箭手", "job_archer_v1"],
  ["軍師", "job_tactician_v1"],
  ["詩人", "job_bard_v1"],
  ["結界師", "job_barrier_mage_v1"],
  ["賭徒", "job_gambler_v1"],
];

// 二轉：baseKey → [變體...]
const T2_VARIANTS = {
  job_swordsman_v1: [
    ["二轉 聖劍士(攻)", "job_holyblade_t2_v1", { stance: "attack" }],
    ["二轉 劍鬼", "job_swordoni_t2_v1", {}],
  ],
  job_warrior_v1: [
    ["二轉 狂戰士", "job_berserker_t2_v1", {}],
    ["二轉 狂戰士(血祭)", "job_berserker_t2_v1", {
      sacrificeHpCostPct: 30, sacrificeAtkUpPct: 25,
      playerActiveEffects: [{ key: "atk_up", target: "self", trigger: "passive", chance: 100,
        params: { value: 25 }, duration: { mode: "battle", value: 1 }, appliedAt: 1, sourceType: "sim" }],
    }],
  ],
  job_dwarf_warrior_v1: [["二轉 矮人戰士長", "job_dwarflord_t2_v1", {}]],
  job_rogue_v1: [
    ["二轉 影舞者", "job_shadowdancer_t2_v1", {}],
    ["二轉 影舞者(影襲)", "job_shadowdancer_t2_v1", { shadowRushHits: 7 }],
  ],
};

// 該職業的代配武器（沒有真實玩家時用）
const FALLBACK_WEAPON = {
  job_swordsman_v1: "sword_2h", job_warrior_v1: "axe_2h", job_dwarf_warrior_v1: "mace_2h",
  job_rogue_v1: "dagger", job_mage_v1: "staff_2h", job_healer_v1: "staff_1h",
  job_archer_v1: "bow", job_tactician_v1: "sword_1h", job_bard_v1: "bow",
  job_barrier_mage_v1: "staff_1h", job_gambler_v1: "dice",
};

async function main() {
  const db = await getMongoDb();
  const sc = createServiceContext();
  const items = db.collection("items");
  const players = db.collection("players");
  const sim = await createWorldBossSim(sc, db, ZONE);

  console.log(`\n【全職業強度對照・真實頂配版】${sim.info}`);
  console.log(`一轉＝該職業真實玩家中的最強配置（各候選 ${PICK_RUNS} 場挑選、代表 ${FINAL_RUNS} 場）；二轉＝一轉代表換徽章\n`);

  // 全服最強（代配防具來源）：拿排行常客的裝備
  const fallbackBase = await db.collection("progress").findOne({ playerId: "386854676433207318" });

  const rows = [];
  for (const [zhName, badgeId] of T1_JOBS) {
    // ① 找該職業的真實玩家
    const cands = await db.collection("progress")
      .find({ "equipment.job_eq.itemId": badgeId, level: { $gte: 40 } }).toArray();
    let rep = null, repName = null, isFallback = false;

    if (cands.length > 0) {
      let best = null, bestDmg = -1;
      for (const p of cands) {
        const r = sim.run(p, { runs: PICK_RUNS });
        if (r.avgDmg > bestDmg) { bestDmg = r.avgDmg; best = p; }
      }
      rep = best;
      const pl = await players.findOne({ discordId: rep.playerId });
      repName = (pl?.displayName || rep.playerId).slice(0, 8);
    } else {
      // ② 代配：最強玩家防具 + 該職業 S 階武器 + 徽章
      const badge = await items.findOne({ id: badgeId });
      const weapon = await items.findOne({ weaponType: FALLBACK_WEAPON[badgeId], tier: "S" });
      const eq = JSON.parse(JSON.stringify(fallbackBase.equipment || {}));
      eq.job_eq = { ...badge, itemId: badge.id, itemName: badge.name, uuid: "fb" };
      eq.weapon = { ...weapon, itemId: weapon.id, itemName: weapon.name, uuid: "fw", enhanceLevel: 5 };
      if (weapon.isTwoHanded) { delete eq.offhand; delete eq.shield; }
      rep = { ...fallbackBase, equipment: eq };
      repName = "（代配）";
      isFallback = true;
    }

    // ③ 一轉正式測
    const base = sim.run(rep, { runs: FINAL_RUNS });
    const stun = sim.run(rep, { runs: FINAL_RUNS, extraOptions: { teamStunRounds: 999 } });
    rows.push({ label: `一轉 ${zhName}`, rep: repName + (isFallback ? "" : ` (${cands.length}人)`),
      weapon: rep.equipment?.weapon?.itemName || "?", ...base, stunDmg: stun.avgDmg });

    // ④ 二轉變體：同一位代表換徽章
    for (const [label, t2Id, extra] of (T2_VARIANTS[badgeId] || [])) {
      const t2badge = await items.findOne({ id: t2Id });
      const eq2 = JSON.parse(JSON.stringify(rep.equipment));
      eq2.job_eq = { ...t2badge, itemId: t2badge.id, itemName: t2badge.name, uuid: "t2" };
      const prog2 = { ...rep, equipment: eq2 };
      const { playerActiveEffects, ...restExtra } = extra;
      const opts = { ...restExtra, ...(playerActiveEffects ? { playerActiveEffects } : {}) };
      const r2 = sim.run(prog2, { runs: FINAL_RUNS, equipment: eq2, extraOptions: opts });
      const s2 = sim.run(prog2, { runs: FINAL_RUNS, equipment: eq2, extraOptions: { ...opts, teamStunRounds: 999 } });
      rows.push({ label, rep: repName, weapon: eq2.weapon?.itemName || "?", ...r2, stunDmg: s2.avgDmg, t1Ref: base.avgDmg });
    }
  }

  rows.sort((a, b) => b.avgDmg - a.avgDmg);
  const top = rows[0].avgDmg;
  const topStun = Math.max(...rows.map((r) => r.stunDmg));
  console.log("職業                 代表(該職業人數)   ┃ 存活  陣亡%    均傷    相對  vs自己一轉 ┃ 巨神震擊窗口    相對");
  console.log("─".repeat(110));
  for (const r of rows) {
    const uplift = r.t1Ref ? `${(r.avgDmg / r.t1Ref).toFixed(2)}x` : "  —  ";
    console.log(
      `${r.label.padEnd(18)} ${String(r.rep).padEnd(16)} ┃ ${r.avgRounds.toFixed(1).padStart(4)} ${(r.deathRate * 100).toFixed(0).padStart(4)}% ` +
      `${Math.round(r.avgDmg).toLocaleString().padStart(8)}  ${(r.avgDmg / top).toFixed(2)}x  ${uplift.padStart(6)} ┃ ` +
      `${Math.round(r.stunDmg).toLocaleString().padStart(9)}  ${(r.stunDmg / topStun).toFixed(2)}x`
    );
  }
  console.log("─".repeat(110));
  console.log("注意：一轉之間的排序含「該職業玩家投資度」的成分（有人+50強化、有人裸裝）——");
  console.log("      看職業機制本身請對照標準化版 balance-job-matrix.js，兩張表一起讀。");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
