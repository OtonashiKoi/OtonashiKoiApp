"use strict";
/**
 * 全職業強度對照表（一轉 11 個 + 二轉 4 個）。
 *
 * 公平比較的作法：
 *   - 同一套防具（取自真實 Lv50 玩家，去掉武器與職業徽章）
 *   - 每個職業配自己的 S 階專精武器（同階、同強化等級）
 *   - 同樣的屬性總點數，依各職業主屬性配點
 *   - 全部走 scripts/lib/simWorldBoss.js（忠實複製線上世界王戰鬥）
 *
 * 用法：node scripts/balance-job-matrix.js [zoneKey]
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { createServiceContext } = require("../src/services/createServiceContext");
const { createWorldBossSim } = require("./lib/simWorldBoss");

const RUNS = Number(process.env.RUNS) || 200;
const ZONE = process.argv[2] || "dragon_king_lair";
const BASE_PLAYER = "386854676433207318"; // 只借防具，武器與徽章都會換掉

/** 屬性總點數 104（真實 Lv50 玩家的水準）：主屬性 40 / VIT 24 / 其餘平均 */
function buildAttrs(main) {
  const a = { str: 10, agi: 10, vit: 24, int: 10, dex: 10, luk: 10 };
  a[main] = 40;
  const total = Object.values(a).reduce((s, v) => s + v, 0);
  a.luk += 104 - total; // 補到 104
  return a;
}

// 職業 → { 徽章, 武器類型, 主屬性, 二轉專用參數 }
const JOBS = [
  ["一轉 劍士",     "job_swordsman_v1",      "sword_2h", "str"],
  ["一轉 戰士",     "job_warrior_v1",        "axe_2h",   "str"],
  ["一轉 矮人戰士", "job_dwarf_warrior_v1",  "mace_2h",  "str"],
  ["一轉 盜賊",     "job_rogue_v1",          "dagger",   "agi"],
  ["一轉 法師",     "job_mage_v1",           "staff_2h", "int"],
  ["一轉 治療師",   "job_healer_v1",         "staff_1h", "int"],
  ["一轉 弓箭手",   "job_archer_v1",         "bow",      "dex"],
  ["一轉 軍師",     "job_tactician_v1",      "sword_1h", "int"],
  ["一轉 詩人",     "job_bard_v1",           "bow",      "dex"],
  ["一轉 結界師",   "job_barrier_mage_v1",   "staff_1h", "int"],
  ["一轉 賭徒",     "job_gambler_v1",        "dice",     "luk"],
  ["二轉 聖劍士(攻)", "job_holyblade_t2_v1",  "sword_2h", "str", { stance: "attack" }],
  // 防禦姿態必須帶盾 → 主手改單手劍 + 最高階盾（A 階秘銀盾，全遊戲沒有 S 階盾）
  ["二轉 聖劍士(防)", "job_holyblade_t2_v1",  "sword_1h", "str", { stance: "defense", _shield: true }],
  ["二轉 劍鬼",      "job_swordoni_t2_v1",   "sword_2h", "str"],
  ["二轉 狂戰士",    "job_berserker_t2_v1",  "axe_2h",   "str"],
  ["二轉 狂戰士(血祭)", "job_berserker_t2_v1", "axe_2h",  "str", { sacrificeHpCostPct: 30, sacrificeAtkUpPct: 25,
    playerActiveEffects: [{ key: "atk_up", target: "self", trigger: "passive", chance: 100,
      params: { value: 25 }, duration: { mode: "battle", value: 1 }, appliedAt: 1, sourceType: "sim" }] }],
  ["二轉 矮人戰士長", "job_dwarflord_t2_v1",  "mace_2h",  "str"],
];

// 巨神震擊是**給全隊的免傷窗口**，不是矮人專屬 buff。
// 拿「窗口內的矮人」去跟「窗口外的其他職業」比是錯的框架 →
// 改成每個職業各自跑「窗口外 / 窗口內」兩欄，看誰最會利用這 20 秒。

async function main() {
  const db = await getMongoDb();
  const sc = createServiceContext();
  const items = db.collection("items");
  const sim = await createWorldBossSim(sc, db, ZONE);
  const base = await db.collection("progress").findOne({ playerId: BASE_PLAYER });

  console.log(`\n【全職業強度對照】${sim.info}`);
  console.log(`基準：同一套防具｜各職業 S 階專精武器｜屬性總點 104（主屬性 40 / VIT 24 / 其餘 10）｜每組 ${RUNS} 場\n`);

  const rows = [];
  for (const [label, badgeId, wt, mainStat, extra = {}] of JOBS) {
    const badge = await items.findOne({ id: badgeId });
    const weapon = await items.findOne({ weaponType: wt, tier: "S" });
    if (!badge || !weapon) { console.log(`  ⚠️ 跳過 ${label}（缺${!badge ? "徽章" : "武器"}）`); continue; }

    const eq = JSON.parse(JSON.stringify(base.equipment || {}));
    eq.job_eq = { ...badge, itemId: badge.id, itemName: badge.name, uuid: "sim-badge" };
    eq.weapon = { ...weapon, itemId: weapon.id, itemName: weapon.name, uuid: "sim-weapon", enhanceLevel: 0 };
    // 雙手武器不可配副手/盾；單手武器統一不配（避免雙持讓某些職業佔便宜）
    delete eq.offhand; delete eq.shield;
    // 例外：聖劍士防禦姿態強制需要盾（後端會擋沒帶盾的請求）
    if (extra._shield) {
      const shield = await items.findOne({ equipSlot: "shield", tier: "A", weaponType: null });
      if (shield) eq.shield = { ...shield, itemId: shield.id, itemName: shield.name, uuid: "sim-shield", enhanceLevel: 0 };
    }
    // ⚠️ 借來的防具帶 STR+55 / AGI+31 / LUK+23 但 INT・DEX 各 0 →
    //    STR 系職業白拿 55 點主屬性、法師/弓箭手拿 0，比出來的東西沒意義。
    //    但也不能整組歸零——防具的 VIT+100 是活下來的關鍵，砍掉會變成「大家都 0.3 回合暴斃」。
    //    作法：**保留防禦向的 VIT 原樣，把攻擊向的屬性全部中和成「該職業主屬性 +ARMOR_MAIN」**，
    //    等於每個職業都拿到一套「為自己職業打造」的同級防具。
    const ARMOR_MAIN = 55; // 對齊基準玩家防具實際提供的主屬性量
    let vitGiven = false;
    for (const [slot, it] of Object.entries(eq)) {
      if (slot === "weapon" || slot === "job_eq" || !it?.equipStats) continue;
      const vit = Number(it.equipStats.vit) || 0;
      const zero = { str: 0, agi: 0, vit, int: 0, dex: 0, luk: 0 };
      if (!vitGiven) { zero[mainStat] += ARMOR_MAIN; vitGiven = true; } // 集中放在第一件，總量一致
      eq[slot] = { ...it, equipStats: zero };
    }

    const progress = { ...base, attributes: buildAttrs(mainStat), equipment: eq };
    const { playerActiveEffects, _shield, ...restExtra } = extra;
    const baseOpts = { ...restExtra, ...(playerActiveEffects ? { playerActiveEffects } : {}) };
    const normal = sim.run(progress, { runs: RUNS, equipment: eq, extraOptions: baseOpts });
    // 巨神震擊窗口內：怪物整場不出手（全隊都吃得到）
    const stunned = sim.run(progress, { runs: RUNS, equipment: eq, extraOptions: { ...baseOpts, teamStunRounds: 999 } });
    rows.push({ label, wt, ...normal, stunDmg: stunned.avgDmg, stunRounds: stunned.avgRounds });
  }

  rows.sort((a, b) => b.avgDmg - a.avgDmg);
  const top = rows[0].avgDmg;
  const topStun = Math.max(...rows.map((r) => r.stunDmg));
  console.log("職業                武器        ATK  ┃ 平時：存活 陣亡%    均傷   相對 ┃ 巨神震擊窗口內：均傷   相對  增幅");
  console.log("─".repeat(108));
  for (const r of rows) {
    console.log(
      `${r.label.padEnd(18)} ${r.wt.padEnd(10)} ${String(r.atk).padStart(4)}  ┃ ` +
      `${r.avgRounds.toFixed(1).padStart(5)} ${(r.deathRate * 100).toFixed(0).padStart(4)}% ${Math.round(r.avgDmg).toLocaleString().padStart(8)} ${(r.avgDmg / top).toFixed(2)}x ┃ ` +
      `${Math.round(r.stunDmg).toLocaleString().padStart(16)} ${(r.stunDmg / topStun).toFixed(2)}x ${(r.stunDmg / Math.max(1, r.avgDmg)).toFixed(1)}x`
    );
  }
  console.log("─".repeat(108));
  const t1 = rows.filter((r) => r.label.startsWith("一轉"));
  const t2 = rows.filter((r) => r.label.startsWith("二轉"));
  const avg = (a) => a.reduce((s, x) => s + x.avgDmg, 0) / a.length;
  console.log(`一轉平均 ${Math.round(avg(t1)).toLocaleString()}｜二轉平均 ${Math.round(avg(t2)).toLocaleString()}｜二轉/一轉 ${(avg(t2) / avg(t1)).toFixed(2)}x`);
  console.log(`一轉最強 ${t1[0].label}（${Math.round(t1[0].avgDmg).toLocaleString()}）｜一轉最弱 ${t1[t1.length-1].label}（${Math.round(t1[t1.length-1].avgDmg).toLocaleString()}）｜差距 ${(t1[0].avgDmg / t1[t1.length-1].avgDmg).toFixed(1)}x`);
  const gains = rows.map((r) => ({ label: r.label, gain: r.stunDmg / Math.max(1, r.avgDmg) })).sort((a, b) => b.gain - a.gain);
  console.log(`\n巨神震擊窗口最受惠：${gains.slice(0,3).map((g) => `${g.label} ${g.gain.toFixed(1)}x`).join("、")}`);
  console.log(`最不受惠：${gains.slice(-3).map((g) => `${g.label} ${g.gain.toFixed(1)}x`).join("、")}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
