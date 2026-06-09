"use strict";
/** 測試用:模擬 6 名 Lv.50 玩家從 1 樓開始攻塔,用真實 fightFloor/pickFloorMonster(磁碟最新碼)。只讀不寫。 */
require("dotenv").config();

const PLAYER_IDS = [
  "201822843799863296", "386854676433207318", "354649411428810752",
  "404245980654075905", "426418808895569932", "693452522379280474",
];

(async () => {
  const { createMongoRepositories } = require("../src/adapters/mongo/createMongoRepositories");
  const repos = await createMongoRepositories();
  const { calcPlayerStats } = require("../src/shared/combatStats");
  const { mergeEquippedFromLibrary } = require("../src/shared/effectEngine");
  const TW = require("../src/shared/towerConfig");
  const { fightFloor, pickFloorMonster } = require("../src/bot/handlers/towerHandlers");

  // 建 6 名成員
  const members = [];
  for (const pid of PLAYER_IDS) {
    const prog = await repos.progressRepository.findByPlayerId(pid);
    if (!prog) continue;
    const equipped = await mergeEquippedFromLibrary(prog.equipment || {}, repos.itemRepository);
    const stats = calcPlayerStats(prog.attributes || {}, equipped, [], prog.inventory || []);
    const jobName = equipped?.job_eq?.itemName || equipped?.job_eq?.name || "無職業";
    members.push({
      discordId: pid, name: (jobName + ":" + pid.slice(-4)), level: prog.level || 50,
      stats, baseMaxHp: stats.maxHp, equipped, inventory: prog.inventory || [],
      currentHp: stats.maxHp, maxHp: stats.maxHp, activeEffects: [],
      cardCooldowns: { player: {}, monster: {} }, job: { name: jobName },
    });
  }
  console.log("隊伍(6人 Lv.50):");
  for (const m of members) console.log("  " + m.name + "  atk=" + m.stats.atk + " maxHp=" + m.baseMaxHp + " agi=" + m.stats.agi + " crit=" + Math.round(m.stats.crit) + "%");
  console.log("");

  const session = { members, currentFloor: 0, clearedFloor: 0, leaderId: members[0].discordId, state: "ready_to_fight" };

  console.log("樓 | 怪物 | 縮放HP | 回合 | 擊殺 | 存活 | 隊伍存活/HP摘要");
  for (let floor = 1; floor <= TW.TOWER_TOTAL_FLOORS; floor++) {
    session.currentFloor = floor;
    // 套用該層累積 HP 加成(maxHp 隨層提升,currentHp 帶傷不回)
    const bonus = TW.getCumulativePartyBonus(floor);
    for (const m of members) {
      const newMax = Math.round(m.baseMaxHp * (1 + bonus.hpPct / 100));
      m.maxHp = newMax;
      if (m.currentHp > newMax) m.currentHp = newMax;
      if (floor === 1) m.currentHp = newMax;
    }
    const monster = await pickFloorMonster(floor);
    if (!monster) { console.log("  " + floor + " | (找不到怪) 中止"); break; }
    const scaledHp = TW.scaleTowerMonsterHp(monster.calc?.maxHp || monster.maxHp || 200, floor);
    const scaledAtk = TW.scaleTowerMonsterAtk(monster.calc?.atk || 20, floor);

    const res = await fightFloor(session, monster, scaledHp, scaledAtk);
    const alive = members.filter((m) => m.currentHp > 0).length;
    const hpSummary = members.map((m) => Math.max(0, Math.round(m.currentHp)) + "/" + m.maxHp).join(" ");
    console.log("  " + String(floor).padStart(2) + " | " + monster.name + " | " + scaledHp.toLocaleString() + " | " + res.totalRounds + " | " + (res.monsterKilled ? "✅" : "❌") + " | " + alive + "/6 | " + hpSummary);

    if (!res.monsterKilled || !res.survived) {
      console.log("\n>>> 第 " + floor + " 層止步(" + (!res.monsterKilled ? "未擊殺" : "全滅") + ")。最高通關 = " + session.clearedFloor + " 層");
      process.exit(0);
    }
    session.clearedFloor = floor;
  }
  console.log("\n>>> 全 " + TW.TOWER_TOTAL_FLOORS + " 層通關!");
  process.exit(0);
})().catch((e) => { console.error("失敗:", e?.stack || e); process.exit(1); });
