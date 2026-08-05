"use strict";
/**
 * 盜靈（盜賊二轉 B）數值驗證：對照組＝影舞者（同 A/B 分支、同武器、同屬性預算）。
 *
 * 量三種情境：
 *   影舞者           對照基準
 *   盜靈・得手可用    對「新的一隻怪」的第一場（steal 未用）
 *   盜靈・得手已用    同一隻怪的後續場次（世界王絕大多數場次都是這個）← 真實穩態
 *
 * ⚠️ 每隻怪只能偷一次（含世界王）→ 世界王長期均值幾乎全由「得手已用」決定。
 *
 * 用法：node scripts/sim-spiritthief.js [zoneKey] [GREAT_MULT]
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { createServiceContext } = require("../src/services/createServiceContext");
const { createWorldBossSim } = require("./lib/simWorldBoss");

const RUNS = Number(process.env.RUNS) || 1000;
const ZONE = process.argv[2] || "dragon_king_lair";
const GREAT_MULT_OVERRIDE = Number(process.argv[3]) || null;
const BASE_PLAYER = "386854676433207318";

// 隔離測試：徽章屬性與效果與影舞者「完全相同」，唯一差異＝巧手/得手 vs 連擊氣條。
// （identity 用的 luk 傾斜等徽章調整，等機制 delta 確定後再單獨測）
const SPIRITTHIEF_STATS = { str: 0, agi: 7, vit: 0, int: 0, dex: 3, luk: 2 };

async function main() {
  const db = await getMongoDb();
  const sc = createServiceContext();
  const items = db.collection("items");
  const sim = await createWorldBossSim(sc, db, ZONE);
  const base = await db.collection("progress").findOne({ playerId: BASE_PLAYER });

  if (GREAT_MULT_OVERRIDE) {
    const ja = require("../src/shared/jobAdvancement");
    ja.T2_BRANCHES.rogue[1].deftHands.aboveGreatMult = GREAT_MULT_OVERRIDE;
    console.log(`（本次覆寫巧手倍率 aboveGreatMult = ${GREAT_MULT_OVERRIDE}）`);
  }

  const shadowBadge = await items.findOne({ id: "job_shadowdancer_t2_v1" });
  const weapon = await items.findOne({ weaponType: "dagger", tier: "S" });
  const offhand = await items.findOne({ weaponType: "offhand_dagger", tier: "A" });

  // 盜靈徽章：DB 還沒建，用影舞者徽章為模板換 id/屬性；
  // **效果原封不動照抄**，確保唯一變因是分支機制本身（巧手/得手 vs 連擊氣條）。
  const thiefBadge = {
    ...shadowBadge,
    id: "job_spiritthief_t2_v1",
    name: "盜靈徽章",
    equipStats: SPIRITTHIEF_STATS,
  };

  function buildEq(badge) {
    const eq = JSON.parse(JSON.stringify(base.equipment || {}));
    eq.job_eq = { ...badge, itemId: badge.id, itemName: badge.name, uuid: "sim-badge" };
    eq.weapon = { ...weapon, itemId: weapon.id, itemName: weapon.name, uuid: "sim-w", enhanceLevel: 0 };
    eq.shield = { ...offhand, itemId: offhand.id, itemName: offhand.name, uuid: "sim-o", enhanceLevel: 0 };
    delete eq.offhand;
    return eq;
  }

  const attrs = { str: 10, agi: 40, vit: 24, int: 10, dex: 10, luk: 10 };
  const cases = [
    ["影舞者（對照）",        shadowBadge, {}],
    ["盜靈・得手可用",        thiefBadge,  { stealUsed: false }],
    ["盜靈・得手已用（穩態）", thiefBadge,  { stealUsed: true }],
  ];

  console.log(`\n【盜靈數值驗證】${sim.info}`);
  console.log(`每組 ${RUNS} 場｜S匕首＋A副手｜屬性 ${JSON.stringify(attrs)}\n`);
  console.log("情境                    ATK   存活  陣亡%      均傷    相對影舞者");
  console.log("─".repeat(70));

  const out = [];
  for (const [label, badge, extra] of cases) {
    const eq = buildEq(badge);
    const progress = { ...base, attributes: attrs, equipment: eq };
    const r = sim.run(progress, { runs: RUNS, equipment: eq, extraOptions: extra });
    out.push({ label, ...r });
  }
  const baseDmg = out[0].avgDmg;
  for (const r of out) {
    console.log(
      `${r.label.padEnd(22)} ${String(r.atk).padStart(4)} ${r.avgRounds.toFixed(1).padStart(6)} ${(r.deathRate * 100).toFixed(0).padStart(5)}% ${Math.round(r.avgDmg).toLocaleString().padStart(9)}   ${(r.avgDmg / baseDmg).toFixed(3)}x`
    );
  }
  console.log("─".repeat(70));
  console.log(`巧手倍率 greatMult = ${require("../src/shared/jobAdvancement").T2_BRANCHES.rogue[1].deftHands.aboveGreatMult}（大成功以上額外倍率）`);
  console.log(`目標：穩態（得手已用）落在影舞者的 0.95~1.00x —— 輸出略低，用掉落收益補回來\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
