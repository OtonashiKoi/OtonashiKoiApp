"use strict";

const assert = require("node:assert/strict");
const {
  TOWER_ROLES,
  normalizeTowerRole,
  scaleTowerAuraEffect,
  scaleTowerRoleHp,
  scaleTowerRoleAtk,
  selectTowerMonsterTarget,
} = require("../src/shared/towerRoles");
const {
  TOWER_MAX_MEMBERS,
  TOWER_TOTAL_FLOORS,
  getTowerFloorBossName,
  getTowerMonsterPool,
} = require("../src/shared/towerConfig");
const { isTowerTester, TOWER_OWNER_TESTER_ID } = require("../src/shared/towerAccess");
const { T2_BRANCHES } = require("../src/shared/jobAdvancement");
const { buildT2MechanicLines } = require("../src/shared/itemEffectLines");

const towerOnlyDescriptionPattern = /爬塔|塔內|塔專屬/;
for (const branches of Object.values(T2_BRANCHES)) {
  for (const branch of branches) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(branch, "towerAura"),
      false,
      `${branch.name} 不得保留 towerAura 設定`,
    );
    assert.doesNotMatch(
      JSON.stringify(branch),
      towerOnlyDescriptionPattern,
      `${branch.name} 設定不得保留塔專屬敘述`,
    );
    assert.doesNotMatch(
      buildT2MechanicLines({ id: branch.id }).join("\n"),
      towerOnlyDescriptionPattern,
      `${branch.name} 職業敘述不得顯示塔專屬光環`,
    );
  }
}

assert.equal(TOWER_MAX_MEMBERS, 6);
assert.equal(TOWER_TOTAL_FLOORS, 71);
assert.equal(getTowerFloorBossName(70), "煉獄烈焰狼王(B)");
assert.equal(getTowerFloorBossName(71), "煉獄烈焰狼王(B)");
assert.equal(getTowerMonsterPool(69).zone, "hellfire");

assert.equal(normalizeTowerRole("坦"), "tank");
assert.equal(normalizeTowerRole("輔助"), "support");
assert.equal(normalizeTowerRole("輸出"), "dps");
assert.equal(normalizeTowerRole("unknown"), null);

assert.deepEqual(
  [TOWER_ROLES.tank, TOWER_ROLES.support, TOWER_ROLES.dps].map((role) => [role.hpMultiplier, role.atkMultiplier, role.auraMultiplier]),
  [[1.3, 0.7, 0.5], [0.7, 0.7, 1.3], [1, 1.2, 0.5]],
);

const aura = { key: "party_damage_up", params: { value: 10 } };
assert.equal(scaleTowerAuraEffect(aura, "tank").params.value, 5);
assert.equal(scaleTowerAuraEffect(aura, "support").params.value, 13);
assert.equal(scaleTowerAuraEffect(aura, "dps").params.value, 5);
assert.equal(aura.params.value, 10, "光環縮放不得改寫原物件");
assert.equal(scaleTowerRoleHp(100, "tank"), 130);
assert.equal(scaleTowerRoleHp(100, "support"), 70);
assert.equal(scaleTowerRoleHp(100, "dps"), 100);
assert.equal(scaleTowerRoleAtk(100, "tank"), 70);
assert.equal(scaleTowerRoleAtk(100, "support"), 70);
assert.equal(scaleTowerRoleAtk(100, "dps"), 120);

const members = [
  { name: "輸出甲", towerRole: "dps", currentHp: 100 },
  { name: "補甲", towerRole: "support", currentHp: 100 },
  { name: "坦甲", towerRole: "tank", currentHp: 100 },
  { name: "坦乙", towerRole: "tank", currentHp: 100 },
];
assert.equal(selectTowerMonsterTarget(members).name, "坦甲", "同站位依隊伍順序選目標");
members[2].currentHp = 0;
assert.equal(selectTowerMonsterTarget(members).name, "坦乙");
members[3].currentHp = 0;
assert.equal(selectTowerMonsterTarget(members).name, "補甲");
members[1].currentHp = 0;
assert.equal(selectTowerMonsterTarget(members).name, "輸出甲");
members[0].currentHp = 0;
assert.equal(selectTowerMonsterTarget(members), null);

assert.equal(isTowerTester(TOWER_OWNER_TESTER_ID), true);
assert.equal(isTowerTester("1030468023468953700"), false);

console.log("✅ 爬塔站位、鎖定順序、71 層、測試白名單與塔專屬光環移除驗證通過");
