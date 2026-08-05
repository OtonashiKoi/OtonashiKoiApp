"use strict";
/**
 * 戰鬥核心黃金測試（重構安全網）。
 *
 * 原理：固定種子跑 N 場戰鬥，把每場的關鍵輸出存成快照。
 * 之後任何「不該改變行為」的改動（重構、抽戰鬥核心、效能優化），
 * 跑 verify 快照全同 ＝ 安全；有差 ＝ 行為被改到了，逐場找。
 *
 * ⚠️ 平衡調整（故意改行為）會讓快照過期——那是預期的，
 *    調完平衡在「基準凍結」時重新 --update 一次即可。
 *
 * 用法：
 *   node scripts/golden-combat-test.js --update   # 產生/更新快照
 *   node scripts/golden-combat-test.js            # 驗證（預設）
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { createServiceContext } = require("../src/services/createServiceContext");
const { createWorldBossSim } = require("./lib/simWorldBoss");
const { withSeed } = require("./lib/seededRandom");

const SNAPSHOT_PATH = path.join(__dirname, "golden", "combat-golden.json");
const BATTLES = 60; // 覆蓋面 vs 執行時間的折衷；三種職業原型 × 20 場

// 三種代表性配置：純輸出（劍士）、坦（聖劍士防）、多段（影舞者）——覆蓋主要程式路徑
const CASES = [
  { key: "swordsman", badgeId: "job_swordsman_v1", weaponType: "sword_2h", attrs: { str: 40, agi: 10, vit: 24, int: 10, dex: 10, luk: 10 } },
  { key: "holyblade_def", badgeId: "job_holyblade_t2_v1", weaponType: "sword_1h", shield: true, stance: "defense", attrs: { str: 30, agi: 10, vit: 34, int: 10, dex: 10, luk: 10 } },
  { key: "shadowdancer", badgeId: "job_shadowdancer_t2_v1", weaponType: "dagger", dual: true, attrs: { str: 10, agi: 40, vit: 24, int: 10, dex: 10, luk: 10 } },
];

async function buildEq(db, base, c) {
  const items = db.collection("items");
  const badge = await items.findOne({ id: c.badgeId });
  const weapon = await items.findOne({ weaponType: c.weaponType, tier: "S" });
  const eq = JSON.parse(JSON.stringify(base.equipment || {}));
  eq.job_eq = { ...badge, itemId: badge.id, itemName: badge.name, uuid: "g-b" };
  eq.weapon = { ...weapon, itemId: weapon.id, itemName: weapon.name, uuid: "g-w", enhanceLevel: 0 };
  delete eq.offhand; delete eq.shield;
  if (c.dual) {
    const off = await items.findOne({ weaponType: "offhand_dagger", tier: "A" });
    if (off) eq.shield = { ...off, itemId: off.id, itemName: off.name, uuid: "g-o", enhanceLevel: 0 };
  }
  if (c.shield) {
    const sh = await items.findOne({ equipSlot: "shield", tier: "A", weaponType: null });
    if (sh) eq.shield = { ...sh, itemId: sh.id, itemName: sh.name, uuid: "g-s", enhanceLevel: 0 };
  }
  return eq;
}

async function run() {
  const db = await getMongoDb();
  const sc = createServiceContext();
  const sim = await createWorldBossSim(sc, db, "dragon_king_lair", null, { fresh: true });
  const base = await db.collection("progress").findOne({ playerId: "386854676433207318" });

  const rows = [];
  for (const c of CASES) {
    const eq = await buildEq(db, base, c);
    const progress = { ...base, attributes: c.attrs, equipment: eq };
    for (let i = 0; i < BATTLES / CASES.length; i++) {
      const seed = `golden:${c.key}:${i}`;
      const r = withSeed(seed, () => sim.single(progress, {
        equipment: eq,
        extraOptions: { playerActiveEffects: [], ...(c.stance ? { stance: c.stance } : {}) },
      }));
      rows.push({
        seed,
        outcome: r.outcome,
        rounds: (r.nextRound || 2) - 1,
        totalDamage: r.totalDamage || 0,
        damageTaken: r.damageTaken || 0,
        maxHitTaken: r.maxHitTaken || 0,
      });
    }
  }
  return rows;
}

(async () => {
  const update = process.argv.includes("--update");
  const rows = await run();

  if (update) {
    fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify({ note: "戰鬥核心黃金快照——重構驗證用；平衡凍結時 --update 重建", rows }, null, 1));
    console.log(`✅ 黃金快照已更新：${rows.length} 場 → ${SNAPSHOT_PATH}`);
    process.exit(0);
  }

  if (!fs.existsSync(SNAPSHOT_PATH)) {
    console.error("❌ 快照不存在，先跑 node scripts/golden-combat-test.js --update");
    process.exit(1);
  }
  const golden = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")).rows;
  let diff = 0;
  for (let i = 0; i < Math.max(golden.length, rows.length); i++) {
    const a = golden[i], b = rows[i];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      diff++;
      if (diff <= 5) console.log(`✗ ${a?.seed || b?.seed}\n  快照: ${JSON.stringify(a)}\n  現在: ${JSON.stringify(b)}`);
    }
  }
  if (diff === 0) {
    console.log(`✅ 黃金測試通過：${rows.length} 場全部位元級一致`);
    process.exit(0);
  }
  console.error(`❌ ${diff}/${golden.length} 場不一致——戰鬥行為被改動了（平衡調整屬預期，重構則是 bug）`);
  process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
