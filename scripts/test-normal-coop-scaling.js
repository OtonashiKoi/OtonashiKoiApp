"use strict";

const assert = require("node:assert/strict");
const { normalExpMultiplier, normalExpPerPlayer, normalMaxHp, scaleNormalMonster } = require("../src/services/monster/normalCoopScaling");
const { settleActiveMonsterDamage } = require("../src/services/monster/monsterStateRaceGuard");

async function main() {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(normalExpMultiplier), [1, 1, 1.6, 1.9, 2.2, 2.5, 2.5]);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 100].map(n => normalExpPerPlayer(1000, n)), [1000, 800, 850, 900, 950, 1000, 1000, 1000]);
  for (let base = 1; base <= 1000; base++) for (let n = 2; n <= 20; n++) {
    const share = normalExpPerPlayer(base, n);
    assert.ok(share >= base * 0.8 && share <= base, "integer EXP must stay within the 80–100% bounds");
    if (n > 2) assert.ok(share >= normalExpPerPlayer(base, n - 1), "more players must not reduce the share");
  }
  const monster = { seq: 9, calc: { maxHp: 100 } };
  let state = { activeMonsterSeq: 9, currentHp: 100, damageMap: {} };
  const service = {
    async getState() { return structuredClone(state); },
    async saveStateIfActiveMonster(next, _zone, seq, hp) {
      if (state.activeMonsterSeq !== seq || state.currentHp !== hp) return false;
      state = structuredClone(next);
      return true;
    }
  };
  for (let i = 1; i <= 6; i += 1) {
    await settleActiveMonsterDamage({ monsterService: service, zoneKey: "normal", monster,
      discordId: `p${i}`, displayName: `p${i}`, playerLevel: 1, totalDamage: 1, totalTaken: 0 });
    assert.equal(normalMaxHp(state, monster), 100);
    assert.equal(state.currentHp, normalMaxHp(state, monster) - i, "擴血必須保留既有傷害");
  }
  assert.equal(scaleNormalMonster({currentHp:140,coopMaxHp:280,coopHpMonsterSeq:9},monster,{}).currentHp,50,"retiring old expansion preserves remaining HP proportion");
  const grouped={...monster,zone:"normal"},group=require("../src/shared/encounterGroup");
  for(let hp=0;hp<=840;hp++){const old={currentHp:hp,coopMaxHp:840,coopHpMonsterSeq:9,encounterCount:3,encounterMonsterSeq:9};const scaled=scaleNormalMonster(old,grouped,{});assert.equal(group.remaining(scaled.currentHp,100,3),group.remaining(hp,280,3),"migration must preserve remaining monster count");}
  const before = state.currentHp;
  const idle = scaleNormalMonster(state, monster, { ...state.damageMap, idle: { damage: 0, assist: 0 } });
  assert.equal(idle.coopMaxHp, 100, "未貢獻者不能增加血量");
  assert.equal(idle.currentHp, before);
  assert.equal(normalMaxHp(state, { seq: 10, calc: { maxHp: 50 } }), 50, "換怪不能沿用上隻的血量");
  state = { activeMonsterSeq: 9, currentHp: 100, damageMap: {} };
  await Promise.all([
    settleActiveMonsterDamage({ monsterService: service, zoneKey: "normal", monster,
      discordId: "a", displayName: "a", playerLevel: 1, totalDamage: 20, totalTaken: 0 }),
    settleActiveMonsterDamage({ monsterService: service, zoneKey: "normal", monster,
      discordId: "b", displayName: "b", playerLevel: 1, totalDamage: 20, totalTaken: 0,
      selfDamage: 10, directDamageBySource: { helper: 10 } })
  ]);
  assert.equal(state.coopMaxHp, 100, "跨入口並發應保留三位有效貢獻者");
  assert.equal(state.currentHp, 60, "兩場傷害不可互相覆寫");
  assert.equal(state.damageMap.b.damage, 10);
  assert.equal(state.damageMap.helper.damage, 10);
  console.log("PASS: normal coop EXP table, fixed HP independent of contributors, damage preservation and spawn isolation");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
