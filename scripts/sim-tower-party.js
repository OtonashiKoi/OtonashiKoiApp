"use strict";
/** 用 T0008 原班 5 人(真實角色/裝備/卡)跑 N 次完整塔,看是否穩定通關 52。只讀不寫。 */
require("dotenv").config();

const PLAYER_IDS = [
  "1206243571863261286", // 私麻雀本当下手
  "860551109042110475",  // B.Y
  "201822843799863296",  // 麻婆
  "344786855235026944",  // 吉胃服適咩
  "426418808895569932",  // ℍ𝕦𝕟𝕥𝕖𝕣漢格
];
const RUNS = Number(process.argv[2]) || 10;

(async () => {
  const { createMongoRepositories } = require("../src/adapters/mongo/createMongoRepositories");
  const repos = await createMongoRepositories();
  const { calcPlayerStats } = require("../src/shared/combatStats");
  const { mergeEquippedFromLibrary, applyEffectInstances } = require("../src/shared/effectEngine");
  const TW = require("../src/shared/towerConfig");
  const { fightFloor, pickFloorMonster } = require("../src/bot/handlers/towerHandlers");

  // 可選:套用「過關祝福」模擬連續開塔帶 buff 的情況。 node sim-tower-party.js 10 buff
  const APPLY_BUFF = process.argv[3] === "buff";
  let buffActive = [];
  if (APPLY_BUFF) {
    const b = TW.getTowerClearBuff(41); // Lv.7 終焉:atk×1.15/def×1.10/maxHp×1.15
    const toApply = b.effects.map((e) => ({ ...e, duration: { mode: "seconds", value: b.durationSec }, stackMode: "refresh" }));
    buffActive = applyEffectInstances([], toApply, { source: "tower_buff", sourceType: "tower_buff" });
    console.log(`【已套用過關祝福 ${b.label}:atk×1.15/def×1.10/maxHp×1.15】\n`);
  }

  // 載入一次：每人真實 gear/attrs/inventory/stats（不變的部分）
  const base = [];
  for (const pid of PLAYER_IDS) {
    const prog = await repos.progressRepository.findByPlayerId(pid);
    if (!prog) { console.log("找不到", pid); continue; }
    const equipped = await mergeEquippedFromLibrary(prog.equipment || {}, repos.itemRepository);
    const stats = calcPlayerStats(prog.attributes || {}, equipped, [], prog.inventory || []);
    const jobName = equipped?.job_eq?.itemName || equipped?.job_eq?.name || "無職業";
    base.push({ pid, name: jobName + ":" + pid.slice(-4), level: prog.level || 50, stats, equipped, inventory: prog.inventory || [] });
  }
  console.log(`隊伍(${base.length} 人):`);
  for (const b of base) console.log(`  ${b.name} Lv${b.level} atk=${b.stats.atk} maxHp=${b.stats.maxHp} agi=${b.stats.agi} crit=${Math.round(b.stats.crit)}%`);
  console.log(`\n跑 ${RUNS} 次完整塔(1~${TW.TOWER_TOTAL_FLOORS})：\n`);

  const results = [];
  for (let run = 1; run <= RUNS; run++) {
    // 每次重建可變狀態
    const members = base.map((b) => ({
      discordId: b.pid, name: b.name, level: b.level, stats: b.stats, baseMaxHp: b.stats.maxHp,
      equipped: b.equipped, inventory: b.inventory, currentHp: b.stats.maxHp, maxHp: b.stats.maxHp,
      activeEffects: APPLY_BUFF ? buffActive.map((e) => ({ ...e, params: { ...e.params } })) : [],
      cardCooldowns: { player: {}, monster: {} }, job: { name: b.name },
    }));
    const START_FLOOR = Number(process.argv[4]) || 1;
    const session = { members, currentFloor: 0, clearedFloor: START_FLOOR - 1, leaderId: members[0].discordId, state: "ready_to_fight" };
    let stopFloor = null, reason = "";
    for (let floor = START_FLOOR; floor <= TW.TOWER_TOTAL_FLOORS; floor++) {
      session.currentFloor = floor;
      const bonus = TW.getCumulativePartyBonus(floor);
      for (const m of members) {
        const newMax = Math.round(m.baseMaxHp * (1 + bonus.hpPct / 100));
        m.maxHp = newMax;
        if (m.currentHp > newMax) m.currentHp = newMax;
        if (floor === START_FLOOR) m.currentHp = newMax;
      }
      const monster = await pickFloorMonster(floor);
      if (!monster) { stopFloor = floor; reason = "找不到怪"; break; }
      const scaledHp = TW.scaleTowerMonsterHp(monster.calc?.maxHp || monster.maxHp || 200, floor);
      const scaledAtk = TW.scaleTowerMonsterAtk(monster.calc?.atk || 20, floor);
      const res = await fightFloor(session, monster, scaledHp, scaledAtk);
      if (!res.monsterKilled || !res.survived) { stopFloor = floor; reason = !res.monsterKilled ? `打不死 ${monster.name}` : "全滅"; break; }
      session.clearedFloor = floor;
    }
    const cleared = session.clearedFloor;
    results.push(cleared);
    console.log(`  Run ${String(run).padStart(2)}: 通關到 ${cleared} 樓` + (cleared >= TW.TOWER_TOTAL_FLOORS ? " 🏆全破!" : `（第 ${stopFloor} 層止步：${reason}）`));
  }

  const full = results.filter((f) => f >= TW.TOWER_TOTAL_FLOORS).length;
  const max = Math.max(...results), min = Math.min(...results);
  const avg = (results.reduce((a, b) => a + b, 0) / results.length).toFixed(1);
  console.log(`\n=== 統計(${RUNS} 次)===`);
  console.log(`  全破 52 樓：${full}/${RUNS} 次（${(full / RUNS * 100).toFixed(0)}%）`);
  console.log(`  到達樓層：最低 ${min}、最高 ${max}、平均 ${avg}`);
  process.exit(0);
})().catch((e) => { console.error("失敗:", e?.stack || e); process.exit(1); });
