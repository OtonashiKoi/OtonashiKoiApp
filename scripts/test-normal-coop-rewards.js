"use strict";

const assert = require("node:assert/strict");
const { grantKillCurrencyAndExp } = require("../src/services/battle/grantKillCurrencyAndExp");
const { grantKillDrops } = require("../src/services/battle/grantKillDrops");

const fatiguePath = require.resolve("../src/services/farmFatigue/farmFatigueService");
require.cache[fatiguePath] = {
  id: fatiguePath, filename: fatiguePath, loaded: true,
  exports: { applyAndGetMultiplier: async () => 1 }
};

async function main() {
  const gold = [], exp = [];
  const players = new Map(["attacker", "support", "idle", "third"].map((id) => [id, {
    playerId: id, inventory: [], equipment: {}, level: 1, updatedAt: `before-${id}`
  }]));
  const sc = {
    progressRepository: {
      findByPlayerId: async (id) => structuredClone(players.get(id)),
      saveIfUnchanged: async (next, expected) => {
        if (players.get(next.playerId)?.updatedAt !== expected) return false;
        players.set(next.playerId, next);
        return true;
      }
    },
    itemRepository: { findById: async (id) => id === "test-item" ? {
      id, name: "測試戰利品", itemType: "consumable", effect: { type: "none", value: 0 }
    } : null },
    rewardService: { grantCurrency: async (entry) => gold.push(entry) },
    progressService: { grantExp: async (entry) => {
      exp.push(entry);
      return { levelUps: 0, progress: { level: 1 } };
    } },
    worldBossServiceFor: () => null
  };
  const monster = { name: "測試怪", calc: { maxHp: 100 }, goldReward: 220, expReward: 100,
    drops: [{ itemId: "test-item", chance: 100 }] };
  const state = { participants: ["attacker", "support", "idle"], damageMap: {
    attacker: { name: "攻擊者", damage: 100 },
    support: { name: "輔助", damage: 0, assist: 20 },
    idle: { name: "旁觀", damage: 0, assist: 0 }
  } };
  const rewardLines = [];
  const result = await grantKillCurrencyAndExp({ state, discordId: "attacker", displayName: "攻擊者",
    zoneKey: "normal", monster, sc, totalDamage: 100, session: { monsterMaxHp: 100 }, rewardLines });
  assert.deepEqual(result.participants, ["attacker", "support"]);
  assert.deepEqual(gold.map((entry) => [entry.discordId, entry.amount]), [["attacker", 110], ["support", 110]]);
  assert.deepEqual(exp.map((entry) => [entry.discordId, entry.amount]), [["attacker", 50], ["support", 50]]);
  assert.equal(result.mergedDmg.attacker.damage, 100, "尾刀傷害不可重複計算");
  gold.length = 0;
  await grantKillCurrencyAndExp({ state, discordId: "attacker", displayName: "攻擊者",
    zoneKey: "normal", monster: { ...monster, goldReward: 36 }, sc, totalDamage: 100,
    session: { monsterMaxHp: 100 }, rewardLines: [] });
  assert.deepEqual(gold.map(entry => entry.amount), [18, 18], "new base gold is shared without old 220 pool floor");

  await grantKillDrops({ ...result, monster, discordId: "attacker", displayName: "攻擊者",
    rewardLines, sc, zoneKey: "normal" });
  assert.equal(players.get("attacker").inventory.filter((item) => item.itemId === "test-item").length, 1);
  assert.equal(players.get("support").inventory.filter((item) => item.itemId === "test-item").length, 1);
  assert.equal(players.get("idle").inventory.length, 0);
  gold.length = 0;
  exp.length = 0;
  const threeState = { participants: ["attacker", "support", "third"], damageMap: {
    attacker: { damage: 40 }, support: { damage: 40 }, third: { assist: 20 }
  } };
  await grantKillCurrencyAndExp({ state: threeState, discordId: "attacker", displayName: "攻擊者",
    zoneKey: "normal", monster, sc, totalDamage: 40, session: { monsterMaxHp: 100 }, rewardLines: [] });
  assert.deepEqual(exp.map((entry) => entry.amount), [54, 53, 53], "三人共用 ×1.6 經驗池後均分");
  assert.deepEqual(gold.map((entry) => entry.amount), [74, 73, 73], "金幣池維持原規則");
  exp.length = 0;
  players.get('attacker').level = 19;
  players.get('support').level = 9;
  players.get('third').level = 29;
  const mixedLines = [];
  const mixed = await grantKillCurrencyAndExp({ state: threeState, discordId: 'attacker', displayName: '攻擊者',
    zoneKey: 'normal', monster, sc, totalDamage: 40, session: { monsterMaxHp: 100 }, rewardLines: mixedLines });
  assert.deepEqual(exp.map(e => e.amount), [27,53,5], '均分後依各自等級懲罰，不轉給隊友');
  assert.equal(mixed.perPidRewards.attacker.exp,27);
  assert.ok(mixedLines.some(s=>s.includes('跨區 EXP −50%')));
  exp.length = 0;
  await grantKillCurrencyAndExp({ state: threeState, discordId: 'attacker', displayName: '攻擊者',
    zoneKey: 'mid', monster, sc, totalDamage: 40, session: { monsterMaxHp: 100 }, rewardLines: [] });
  assert.deepEqual(exp.map(e=>e.amount),[54,50,27], '低等跨區與高等回刷皆遞減');
  console.log("PASS: normal coop eligibility, EXP multiplier, unchanged gold pool, individual original-rate drops");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
