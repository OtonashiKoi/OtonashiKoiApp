"use strict";
// 影舞者連擊氣條回歸測試：累氣規則/滿格觸發/跨場沿用/換區歸零/舊參數失效
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { createServiceContext } = require("../src/services/createServiceContext");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");
const sg = require("../src/shared/shadowGauge");
const zc = require("../src/shared/zoneCombo");
const ja = require("../src/shared/jobAdvancement");

let pass = 0, fail = 0;
const ck = (l, c, d = "") => { if (c) { pass++; console.log(`  ✅ ${l}`); } else { fail++; console.log(`  ❌ ${l} ${d}`); } };

async function main() {
  const db = await getMongoDb();
  const sc = createServiceContext();
  const items = db.collection("items");
  const prog = await db.collection("progress").findOne({ playerId: "386854676433207318" });
  const badge = await items.findOne({ id: "job_shadowdancer_t2_v1" });
  const dagger = await items.findOne({ weaponType: "dagger", tier: "S" });
  const offDagger = await items.findOne({ weaponType: "offhand_dagger", tier: "A" });

  console.log("① 模組規則");
  ck("只有影舞者有氣條", sg.hasGauge({ itemId: "job_shadowdancer_t2_v1" }) && !sg.hasGauge({ itemId: "job_rogue_v1" }));
  ck("換區歸零", sg.read({ shadowGauge: { zone: "hellfire", grids: 3, updatedAt: Date.now() } }, "elite") === 0);
  ck("同區沿用", sg.read({ shadowGauge: { zone: "hellfire", grids: 3, updatedAt: Date.now() } }, "hellfire") === 3);
  ck("逾時歸零", sg.read({ shadowGauge: { zone: "hellfire", grids: 3, updatedAt: Date.now() - 11 * 60 * 1000 } }, "hellfire") === 0);
  ck("zoneCombo spend 5：10-5+1=6", zc.nextCombo(10, "z", "win", Date.now(), { spend: 5 }).count === 6);
  ck("分支已登記", ja.getT2Branch("job_shadowdancer_t2_v1")?.baseKey === "rogue");
  ck("職業解析回盜賊（繼承連擊率破百等內建加成）", ja.resolveJobKey({ itemId: "job_shadowdancer_t2_v1", itemName: "影舞者徽章" }) === "rogue");

  console.log("② 戰鬥內：累氣與殘影亂舞");
  // 高連擊率 build：雙持匕首
  const eq = JSON.parse(JSON.stringify(prog.equipment));
  eq.job_eq = { ...badge, itemId: badge.id, itemName: badge.name, uuid: "b" };
  eq.weapon = { ...dagger, itemId: dagger.id, itemName: dagger.name, uuid: "w", enhanceLevel: 0 };
  eq.shield = { ...offDagger, itemId: offDagger.id, itemName: offDagger.name, uuid: "o", enhanceLevel: 0 };
  const attrs = { str: 10, agi: 60, vit: 24, int: 10, dex: 10, luk: 10 };
  const ps = calcPlayerStats(attrs, eq, [], prog.inventory || [], {});
  // 驗「連擊率可破百的資格」（上限 300 在 combatLoop 依 hasRogueBadge 判定），不是驗當下數值
  ck("hasRogueBadge=true（連擊率上限 300 資格繼承）", ps.hasRogueBadge === true, String(ps.combo));

  const hell = await sc.monsterService.listMonsters({ includeDisabled: false, zone: "hellfire" });
  const wolf = hell.filter((m) => (m.calc?.maxHp || 0) > 3000).sort((a, b) => b.calc.maxHp - a.calc.maxHp)[0];
  let sawBurst = 0, sawFull = 0, gridsOut = [];
  for (let i = 0; i < 60; i++) {
    const r = runCombatLoop(ps, wolf.calc, wolf.name, wolf.calc.maxHp, 15, {
      playerLevel: 50, equipped: eq, inventory: prog.inventory || [],
      monsterIsBoss: true, monsterEquipped: wolf.equipment || {},
      shadowGaugeGrids: 0,
    });
    const t = JSON.stringify(r.roundLogs);
    if (/殘影亂舞/.test(t)) sawBurst++;
    if (/氣條全滿/.test(t)) sawFull++;
    gridsOut.push(Number(r.shadowGauge) || 0);
  }
  ck("滿格會觸發（60 場中有觸發）", sawFull > 0, String(sawFull));
  ck("殘影亂舞會施放", sawBurst > 0, String(sawBurst));
  ck("戰後氣量有回傳且 ≤5", gridsOut.every((g) => g >= 0 && g <= 5));

  console.log("③ 帶滿格進場 → 第一回合就殘影亂舞");
  {
    const r = runCombatLoop(ps, wolf.calc, wolf.name, wolf.calc.maxHp, 15, {
      playerLevel: 50, equipped: eq, inventory: prog.inventory || [],
      monsterIsBoss: true, monsterEquipped: wolf.equipment || {},
      shadowGaugeGrids: 5,
    });
    const firstRound = String(r.roundLogs[0] || "") + String(r.roundLogs[1] || "");
    ck("第一回合出現殘影亂舞", /殘影亂舞/.test(firstRound), firstRound.slice(0, 80));
  }

  console.log("④ 已移除的影襲參數不可再觸發");
  {
    const r = runCombatLoop(ps, wolf.calc, wolf.name, wolf.calc.maxHp, 15, {
      playerLevel: 50, equipped: eq, inventory: prog.inventory || [],
      monsterIsBoss: true, monsterEquipped: wolf.equipment || {},
      shadowGaugeGrids: 0, shadowRushHits: 7,
    });
    ck("硬塞 shadowRushHits 也不觸發", !/影襲/.test(JSON.stringify(r.roundLogs)));
  }

  console.log("⑤ 非影舞者完全不受影響");
  {
    const eq2 = JSON.parse(JSON.stringify(eq));
    const rogueBadge = await items.findOne({ id: "job_rogue_v1" });
    eq2.job_eq = { ...rogueBadge, itemId: rogueBadge.id, itemName: rogueBadge.name, uuid: "b2" };
    const ps2 = calcPlayerStats(attrs, eq2, [], prog.inventory || [], {});
    const r = runCombatLoop(ps2, wolf.calc, wolf.name, wolf.calc.maxHp, 15, {
      playerLevel: 50, equipped: eq2, inventory: prog.inventory || [],
      monsterIsBoss: true, monsterEquipped: wolf.equipment || {},
      shadowGaugeGrids: 5, shadowRushHits: 7, // 舊客戶端硬塞參數也不該生效
    });
    const t = JSON.stringify(r.roundLogs);
    ck("一轉盜賊塞參數也不觸發", !/殘影亂舞|影襲/.test(t));
    ck("一轉盜賊 shadowGauge 回 null", r.shadowGauge === null);
  }

  console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
