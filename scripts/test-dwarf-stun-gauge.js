"use strict";
// 巨神震擊（矮人戰士長暈眩條）端到端驗證。用假 key，測完刪除，不碰正式資料。
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const dsg = require("../src/shared/dwarfStunGauge");
const ja = require("../src/shared/jobAdvancement");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { createServiceContext } = require("../src/services/createServiceContext");

const KEY = "__stun_test__";
const ZONE = "dragon_king_lair";

let pass = 0, fail = 0;
const check = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${detail}`); }
};

async function main() {
  const db = await getMongoDb();
  const c = db.collection(dsg.COLLECTION);
  await c.deleteOne({ _id: KEY });

  console.log("① 誰能敲");
  check("矮人戰士長能敲", dsg.canKnock({ itemId: "job_dwarflord_t2_v1" }));
  check("一轉矮人戰士敲不動", !dsg.canKnock({ itemId: "job_dwarf_warrior_v1" }));
  check("狂戰士敲不動", !dsg.canKnock({ itemId: "job_berserker_t2_v1" }));
  check("劍鬼敲不動", !dsg.canKnock({ itemId: "job_swordoni_t2_v1" }));
  check("沒徽章敲不動", !dsg.canKnock(null));
  check("門檻預設 300", dsg.thresholdFor(ZONE) === 300, String(dsg.thresholdFor(ZONE)));

  console.log("② 累積與觸發");
  const t0 = Date.now();
  let r = await dsg.knock(KEY, ZONE, 15, "矮甲", t0);
  check("敲 15 → gauge 15", r.gauge === 15 && r.knocked === 15, JSON.stringify(r));
  r = await dsg.knock(KEY, ZONE, 15, "矮乙", t0);
  check("另一人再敲 15 → 累積 30（原子）", r.gauge === 30, String(r.gauge));
  // 一次補到 299
  await c.updateOne({ _id: KEY }, { $set: { gauge: 299 } });
  r = await dsg.knock(KEY, ZONE, 1, "矮甲", t0);
  check("敲滿 300 → 觸發暈眩", r.triggered === true, JSON.stringify(r));
  check("觸發後 gauge 歸零", r.gauge === 0, String(r.gauge));

  console.log("③ 20 秒窗口內全體免傷");
  let st = await dsg.read(KEY, ZONE, t0 + 1000);
  check("1 秒後：暈眩中", st.stunned === true && st.phase === "stunned", st.phase);
  check("剩餘時間約 19 秒", Math.abs(st.stunnedRemainMs - 19000) < 100, String(st.stunnedRemainMs));
  st = await dsg.read(KEY, ZONE, t0 + 19999);
  check("19.9 秒：仍免傷", st.stunned === true);
  st = await dsg.read(KEY, ZONE, t0 + 20001);
  check("20 秒後：不再免傷", st.stunned === false, st.phase);

  console.log("④ 暈眩結束 → 2 分鐘免疫，期間敲不動");
  check("進入免疫階段", st.phase === "immune", st.phase);
  r = await dsg.knock(KEY, ZONE, 15, "矮甲", t0 + 30000);
  check("免疫中敲不動（knocked 0）", r.knocked === 0 && r.phase === "immune", JSON.stringify(r));
  st = await dsg.read(KEY, ZONE, t0 + 20000 + 119000);
  check("免疫最後一秒仍免疫", st.phase === "immune");
  st = await dsg.read(KEY, ZONE, t0 + 20000 + 120001);
  check("2 分鐘後暈眩條回來", st.phase === "charging", st.phase);
  r = await dsg.knock(KEY, ZONE, 10, "矮甲", t0 + 20000 + 120001);
  check("免疫後重新敲：從 0 起算", r.gauge === 10, String(r.gauge));

  console.log("⑤ 多人同時敲滿只觸發一次（CAS）");
  await c.updateOne({ _id: KEY }, { $set: { gauge: 295, stunnedUntil: 0, immuneUntil: 0 } });
  const t1 = Date.now() + 1_000_000;
  const results = await Promise.all([
    dsg.knock(KEY, ZONE, 5, "矮甲", t1),
    dsg.knock(KEY, ZONE, 5, "矮乙", t1),
    dsg.knock(KEY, ZONE, 5, "矮丙", t1),
  ]);
  const triggeredCount = results.filter((x) => x.triggered).length;
  check("三人同時敲滿 → 只有一人觸發", triggeredCount === 1, `triggered=${triggeredCount}`);

  console.log("⑥ 真實戰鬥：暈眩窗口內世界王整場不出手");
  const sc = createServiceContext();
  const prog = await db.collection("progress").findOne({ playerId: "386854676433207318" });
  const ps = calcPlayerStats(prog.attributes || {}, prog.equipment || {}, [], prog.inventory || [], {});
  const list = await sc.monsterService.listMonsters({ includeDisabled: false, zone: ZONE });
  const boss = list.find((m) => m.id === "dragon-king-boss");
  const runs = 30;
  let normDeaths = 0, normTaken = 0, stunDeaths = 0, stunTaken = 0, normDmg = 0, stunDmg = 0, normRounds = 0, stunRounds = 0;
  for (let i = 0; i < runs; i++) {
    const a = runCombatLoop(ps, boss.calc, boss.name, boss.calc.maxHp, 15, {
      playerLevel: prog.level, equipped: prog.equipment, inventory: prog.inventory || [],
      monsterIsBoss: true, monsterEquipped: boss.equipment || {},
    });
    if (a.outcome === "lose") normDeaths++;
    normTaken += a.damageTaken || 0; normDmg += a.totalDamage || 0;
    normRounds += a.combatStats.attackRounds || 0;
    const b = runCombatLoop(ps, boss.calc, boss.name, boss.calc.maxHp, 15, {
      playerLevel: prog.level, equipped: prog.equipment, inventory: prog.inventory || [],
      monsterIsBoss: true, monsterEquipped: boss.equipment || {},
      teamStunRounds: 999,
    });
    if (b.outcome === "lose") stunDeaths++;
    stunTaken += b.damageTaken || 0; stunDmg += b.totalDamage || 0;
    stunRounds += b.combatStats.attackRounds || 0;
  }
  console.log(`   一般：陣亡 ${normDeaths}/${runs}｜承受傷害 ${Math.round(normTaken / runs)}｜均傷 ${Math.round(normDmg / runs).toLocaleString()}｜攻擊回合 ${(normRounds / runs).toFixed(1)}`);
  console.log(`   暈眩：陣亡 ${stunDeaths}/${runs}｜承受傷害 ${Math.round(stunTaken / runs)}｜均傷 ${Math.round(stunDmg / runs).toLocaleString()}｜攻擊回合 ${(stunRounds / runs).toFixed(1)}`);
  // 暈眩場仍可能有零星自傷（大失敗自殘 30%、怪物反傷詞條）——那不是「怪物攻擊」，
  // 所以判定標準是「承受傷害相對一般場降低 95% 以上」而非絕對 0。
  check("暈眩場承受傷害降低 >95%", stunTaken < normTaken * 0.05, `${stunTaken} vs ${normTaken}`);
  check("暈眩場零陣亡", stunDeaths === 0, String(stunDeaths));
  check("一般場確實會受傷（對照組有效）", normTaken > 0);
  console.log(`   → 承受傷害減免 ${(100 - stunTaken / normTaken * 100).toFixed(1)}%｜傷害倍率 ${(stunDmg / normDmg).toFixed(2)}x`);

  console.log("⑦ attackRounds 計數正確（同回合多擊只算 1）");
  check("暈眩場攻擊回合數 ≤ 15（沒有同回合重複計）", stunRounds / runs <= 15, String(stunRounds / runs));
  check("暈眩場攻擊回合數 >12（miss/大失敗的回合本就不算）", stunRounds / runs > 12, String(stunRounds / runs));

  console.log("⑦b 暈眩場的殘餘傷害來源＝自身大失敗，不是怪物攻擊");
  let sawMonsterAttack = false, sawSelfHarm = false;
  for (let i = 0; i < 40; i++) {
    const b = runCombatLoop(ps, boss.calc, boss.name, boss.calc.maxHp, 15, {
      playerLevel: prog.level, equipped: prog.equipment, inventory: prog.inventory || [],
      monsterIsBoss: true, monsterEquipped: boss.equipment || {}, teamStunRounds: 999,
    });
    const txt = JSON.stringify(b.roundLogs);
    if (/大失敗/.test(txt)) sawSelfHarm = true;
    // 怪物實際打到玩家的敘述（受到.*傷害 且在怪物回合）→ 用「巨神震擊」出現次數反證
    const stunLines = (txt.match(/巨神震擊/g) || []).length;
    const monsterTurns = (txt.match(/的回合 ────/g) || []).length;
    if (stunLines * 2 < monsterTurns - 2) sawMonsterAttack = true;
  }
  check("每個怪物回合都被巨神震擊擋下（怪物完全沒出手）", !sawMonsterAttack);
  check("殘餘傷害來自玩家自己的大失敗", sawSelfHarm);

  console.log("⑧ jobAdvancement 分支登記");
  const br = ja.getT2Branch("job_dwarflord_t2_v1");
  check("分支存在且掛在矮人戰士底下", br && br.baseKey === "dwarf_warrior", JSON.stringify(br && br.baseKey));
  check("宣告了 stunGauge", Boolean(br?.stunGauge));
  check("只有一顆攻擊鈕", ja.getBattleActions({ itemId: "job_dwarflord_t2_v1" }).length === 1);

  await c.deleteOne({ _id: KEY });
  console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
