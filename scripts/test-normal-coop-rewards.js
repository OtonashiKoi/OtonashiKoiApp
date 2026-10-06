"use strict";

const assert = require("node:assert/strict");
const { grantKillCurrencyAndExp } = require("../src/services/battle/grantKillCurrencyAndExp");
const { grantKillDrops } = require("../src/services/battle/grantKillDrops");

const fatiguePath = require.resolve("../src/services/farmFatigue/farmFatigueService");
let fatigueMultiplier = 1;
require.cache[fatiguePath] = {
  id: fatiguePath, filename: fatiguePath, loaded: true,
  exports: { applyAndGetMultiplier: async () => fatigueMultiplier }
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
  assert.deepEqual(exp.map((entry) => [entry.discordId, entry.amount]), [["attacker", 80], ["support", 80]]);
  assert.equal(result.mergedDmg.attacker.damage, 100, "尾刀傷害不可重複計算");
  gold.length = 0;
  await grantKillCurrencyAndExp({ state, discordId: "attacker", displayName: "攻擊者",
    zoneKey: "normal", monster: { ...monster, goldReward: 36 }, sc, totalDamage: 100,
    session: { monsterMaxHp: 100 }, rewardLines: [] });
  assert.deepEqual(gold.map(entry => entry.amount), [18, 18], "new base gold is shared without old 220 pool floor");

  await grantKillDrops({ ...result, state, monster, discordId: "attacker", displayName: "攻擊者",
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
  assert.deepEqual(exp.map((entry) => entry.amount), [85, 85, 85], "三人各領基礎85%，輔助同樣適用");
  assert.deepEqual(gold.map((entry) => entry.amount), [74, 73, 73], "金幣池維持原規則");
  for (const [n, expected] of [[1,100],[2,80],[3,85],[4,90],[5,95],[6,100],[7,100],[10,100],[100,100]]) {
    const ids = Array.from({length:n}, (_, i) => `share-${n}-${i}`);
    for (const playerId of ids) players.set(playerId, {playerId, inventory:[], equipment:{}, level:1});
    const shareState = {participants:ids, damageMap:Object.fromEntries(ids.map(id=>[id,{damage:1}]))};
    exp.length = 0;
    await grantKillCurrencyAndExp({state:shareState, discordId:ids[0], displayName:ids[0], zoneKey:'normal', monster, sc, totalDamage:1, session:{}, rewardLines:[]});
    assert.equal(exp.length,n);
    assert.ok(exp.every(e=>e.amount===expected), `${n} players receive the per-player base share without dilution`);
    for (const [encounterCount, groupBaseExp] of [[2,220],[3,360]]) {
      const lines = [];
      exp.length = 0;
      await grantKillCurrencyAndExp({state:{...shareState,encounterCount,encounterMonsterSeq:9,currentHp:0},discordId:ids[0],displayName:ids[0],zoneKey:'normal',monster:{...monster,zone:'normal',seq:9},sc,totalDamage:1,session:{},rewardLines:lines});
      assert.equal(exp.length,n);
      assert.ok(exp.every(e=>e.amount===Math.ceil(groupBaseExp*expected/100)), `${encounterCount} enemies apply the bonus to all ${n} eligible players`);
      assert.ok(lines.some(line=>line.includes(`群怪加成 +${encounterCount===2?10:20}%`)), 'reward text explains the group bonus');
    }
  }
  exp.length = 0;
  await grantKillCurrencyAndExp({state, discordId:'attacker', displayName:'攻擊者', zoneKey:'normal', monster:{...monster,expReward:101}, sc, totalDamage:100, session:{}, rewardLines:[]});
  assert.deepEqual(exp.map(e=>e.amount),[81,81], 'integer rounding preserves the 80% floor');
  players.get('attacker').activeEffects=[{key:'exp_gain_up',params:{value:50}}];
  exp.length=0;
  await grantKillCurrencyAndExp({state, discordId:'attacker', displayName:'攻擊者', zoneKey:'normal', monster, sc, totalDamage:100, session:{}, rewardLines:[]});
  assert.deepEqual(exp.map(e=>e.amount),[120,80], 'personal bonus applies after the capped base share');
  fatigueMultiplier=0.2;exp.length=0;
  await grantKillCurrencyAndExp({state, discordId:'attacker', displayName:'攻擊者', zoneKey:'normal', monster, sc, totalDamage:100, session:{}, rewardLines:[]});
  assert.deepEqual(exp.map(e=>e.amount),[24,16], 'fatigue applies after base share and personal bonus');
  exp.length=0;
  await grantKillCurrencyAndExp({state:{...state,encounterCount:3,encounterMonsterSeq:9},discordId:'attacker',displayName:'攻擊者',zoneKey:'normal',monster:{...monster,zone:'normal',seq:9},sc,totalDamage:100,session:{},rewardLines:[]});
  assert.deepEqual(exp.map(e=>e.amount),[86,58], 'group bonus composes with personal bonus and fatigue');
  fatigueMultiplier=1;players.get('attacker').activeEffects=[];
  exp.length=0;
  await grantKillCurrencyAndExp({state:{participants:['attacker','support'],damageMap:{attacker:{damage:70},support:{damage:30}}}, discordId:'attacker', displayName:'攻擊者', zoneKey:'elite', monster:{...monster,isBoss:true}, sc, totalDamage:70, session:{monsterMaxHp:100}, rewardLines:[]});
  assert.deepEqual(exp.map(e=>e.amount),[70,30], 'world boss retains damage-based rewards');
  exp.length = 0;
  players.get('attacker').level = 19;
  players.get('support').level = 9;
  players.get('third').level = 29;
  const mixedLines = [];
  const mixed = await grantKillCurrencyAndExp({ state: threeState, discordId: 'attacker', displayName: '攻擊者',
    zoneKey: 'normal', monster, sc, totalDamage: 40, session: { monsterMaxHp: 100 }, rewardLines: mixedLines });
  assert.deepEqual(exp.map(e => e.amount), [43,85,9], '基礎分配後依各自等級懲罰，不轉給隊友');
  assert.equal(mixed.perPidRewards.attacker.exp,43);
  assert.ok(mixedLines.some(s=>s.includes('每人基礎 85%')));
  assert.ok(mixedLines.some(s=>s.includes('跨區 EXP −50%')));
  exp.length = 0;
  await grantKillCurrencyAndExp({ state: threeState, discordId: 'attacker', displayName: '攻擊者',
    zoneKey: 'mid', monster, sc, totalDamage: 40, session: { monsterMaxHp: 100 }, rewardLines: [] });
  assert.deepEqual(exp.map(e=>e.amount),[85,81,43], '低等跨區與高等回刷皆遞減');
  gold.length = 0; exp.length = 0;
  const groupMonster = { ...monster, zone: "normal", seq: 9 };
  const groupState = { ...state, encounterCount: 3, encounterMonsterSeq: 9 };
  const groupResult = await grantKillCurrencyAndExp({ state: groupState, discordId: "attacker", displayName: "攻擊者", zoneKey: "normal", monster: groupMonster, sc, totalDamage: 300, session: {}, rewardLines: [] });
  assert.deepEqual(gold.map(e => e.amount), [330,330], "three original gold pools split once");
  assert.deepEqual(exp.map(e => e.amount), [144,288], "three monsters add 20% before 80% per player and cross-zone reduction");
  const beforeItems = new Map([...players].map(([id,p])=>[id,p.inventory.filter(i=>i.itemId==='test-item').length]));
  await grantKillDrops({ ...groupResult, state: groupState, monster: groupMonster, discordId: "attacker", displayName: "攻擊者", rewardLines: [], sc, zoneKey: "normal" });
  for (const id of ['attacker','support']) assert.equal(players.get(id).inventory.filter(i=>i.itemId==='test-item').length-beforeItems.get(id),3, "each player has three independent original-rate rolls");
  assert.equal(players.get('idle').inventory.length,0);
  gold.length = 0; exp.length = 0;
  await grantKillCurrencyAndExp({ state: groupState, discordId: "attacker", displayName: "攻擊者", zoneKey: "normal", monster: { ...groupMonster,isBoss:true }, sc, totalDamage: 100, session: {}, rewardLines: [] });
  assert.deepEqual(gold.map(e=>e.amount),[110,110], "BOSS cannot inherit group reward multiplier");
  assert.deepEqual(exp.map(e=>e.amount),[40,80], "BOSS cannot inherit group EXP bonus");
  console.log("PASS: normal coop eligibility, EXP multiplier, unchanged gold pool, individual original-rate drops");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
