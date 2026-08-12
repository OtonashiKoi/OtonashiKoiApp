"use strict";
// 最終驗證：三條規則
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { createServiceContext } = require("../src/services/createServiceContext");
const N = 300;
let pass = 0, fail = 0;
const ck = (l, c, d = "") => { if (c) { pass++; console.log(`  ✅ ${l}`); } else { fail++; console.log(`  ❌ ${l} ${d}`); } };

async function main() {
  const db = await getMongoDb();
  const sc = createServiceContext();
  const prog = await db.collection("progress").findOne({ playerId: "386854676433207318" });
  const items = db.collection("items");
  const boss = (await sc.monsterService.listMonsters({ includeDisabled: false, zone: "dragon_king_lair" }))
    .find((m) => m.id === "dragon-king-boss");
  // 真正的一般怪：isBoss 必須為 false（combatLoop 的 monsterIsBossUnit 也會讀 mCalc.isBoss）
  const mob = (await sc.monsterService.listMonsters({ includeDisabled: false, zone: "hellfire" }))
    .filter((m) => !m.isBoss && !m.calc?.isBoss).sort((a, b) => (b.calc?.maxHp || 0) - (a.calc?.maxHp || 0))[0];

  const mk = async (badgeId, wt) => {
    const badge = await items.findOne({ id: badgeId });
    const eq = JSON.parse(JSON.stringify(prog.equipment));
    eq.job_eq = { ...badge, itemId: badge.id, itemName: badge.name, uuid: "sim" };
    eq.weapon = { ...eq.weapon, weaponType: wt, isTwoHanded: wt.endsWith("2h"), itemName: "測試槌" };
    if (wt.endsWith("2h")) delete eq.offhand;
    return eq;
  };
  const run = (eq, mc, mName, mEq, opts = {}) => {
    const ps = calcPlayerStats(prog.attributes || {}, eq, [], prog.inventory || [], {});
    let maxStreak = 0, stunned = 0, mturns = 0, taken = 0, damage = 0, breakLogs = 0;
    for (let i = 0; i < N; i++) {
      const r = runCombatLoop(ps, mc, mName, mc.maxHp, 15, {
        playerLevel: prog.level, equipped: eq, inventory: prog.inventory || [],
        monsterIsBoss: !!opts.isBoss, monsterEquipped: mEq || {}, ...opts,
      });
      const t = JSON.stringify(r.roundLogs);
      stunned += (t.match(/擊暈狀態，無法攻擊|癱倒在地/g) || []).length;
      mturns += Array.isArray(r.roundLogs) ? r.roundLogs.length : 0;
      taken += r.damageTaken || 0;
      damage += r.totalDamage || 0;
      breakLogs += (t.match(/本場防禦 \*\*-50%\*\*/g) || []).length;
      // 單場最長連續暈眩：找戰報裡「接下來 N 回合無法攻擊」的最大 N
      for (const m of (t.match(/接下來 (\d+) 回合無法攻擊/g) || [])) {
        maxStreak = Math.max(maxStreak, Number(m.match(/(\d+)/)[1]));
      }
    }
    return { stunPct: stunned / mturns, taken: taken / N, damage: damage / N, breakLogs, maxStreak };
  };

  console.log("① 世界王：任何職業拿槌最多暈 1 回合");
  const t1 = await mk("job_dwarf_warrior_v1", "mace_2h");
  const a = run(t1, boss.calc, boss.name, boss.equipment, { isBoss: true });
  ck("一轉矮人：單次暈眩最長 1 回合", a.maxStreak === 1, `實際 ${a.maxStreak}`);
  ck("一轉矮人：暈眩覆蓋率降到 ~16%", a.stunPct > 0.10 && a.stunPct < 0.22, (a.stunPct * 100).toFixed(0) + "%");

  console.log("② 矮人戰士長：暈 2 回合（巨神之握）");
  const t2 = await mk("job_dwarflord_t2_v1", "mace_2h");
  const b = run(t2, boss.calc, boss.name, boss.equipment, { isBoss: true });
  ck("二轉矮人：單次暈眩最長 2 回合", b.maxStreak === 2, `實際 ${b.maxStreak}`);
  ck("二轉暈眩覆蓋率約為一轉的兩倍", b.stunPct > a.stunPct * 1.5, `${(a.stunPct*100).toFixed(0)}% → ${(b.stunPct*100).toFixed(0)}%`);

  console.log("③ 巨神震擊：不受上限與免疫管制，整場強制暈眩");
  const c = run(t2, boss.calc, boss.name, boss.equipment, { isBoss: true, teamStunRounds: 999 });
  // 分母含玩家在本回合擊殺王、怪物原本就不會行動的終結回合，故覆蓋率容許落在 90% 以上；承傷對照才是硬驗收。
  ck("巨神震擊場：所有可行動怪物回合都被阻止", c.stunPct > 0.90, (c.stunPct * 100).toFixed(0) + "%");
  ck("巨神震擊場：承受傷害趨近 0", c.taken < a.taken * 0.05, `${Math.round(c.taken)} vs ${Math.round(a.taken)}`);

  console.log(`④ 一般怪不受影響（維持 3 回合暈眩、無免疫）— 用 ${mob.name}`);
  const d = run(t2, mob.calc, mob.name, mob.equipment, { isBoss: false });
  ck("一般怪：單次暈眩仍是 3 回合", d.maxStreak === 3, `實際 ${d.maxStreak}`);
  ck("一般怪：暈眩覆蓋率明顯高於世界王", d.stunPct > b.stunPct, `一般怪 ${(d.stunPct*100).toFixed(0)}% vs 王 ${(b.stunPct*100).toFixed(0)}%`);

  console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
