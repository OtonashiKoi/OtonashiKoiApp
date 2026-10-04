"use strict";
const assert = require("node:assert/strict");
const { canPlayerAccessZone, getVisibleZoneKeys, getPublicZoneKeys, shouldBroadcastZoneActivity } = require("../src/shared/zones");
const { _doIdleRotate } = require("../src/services/battle/doIdleRotate");
const { IdleService } = require("../src/services/idle/idleService");
async function main() {
  for (const zone of ["event_1", "event_boss"]) {
    for (const player of ["865264891991425055", "ordinary-player", undefined]) {
      assert.equal(canPlayerAccessZone(zone, player), false);
      assert.equal(getVisibleZoneKeys(player).includes(zone), false);
    }
    assert.equal(getPublicZoneKeys().includes(zone), false);
    assert.equal(shouldBroadcastZoneActivity(zone), false);
    await _doIdleRotate({ monsterService: { getState: () => { throw new Error("Paused zone touched runtime state"); } } }, zone);
  }
  assert.equal(canPlayerAccessZone("beginner", "ordinary-player"), true);
  assert.equal(canPlayerAccessZone("event_boss_hutao_preview", "865264891991425055"), true);
  assert.equal(canPlayerAccessZone("event_boss_hutao_preview", "ordinary-player"), false);
  const idle = new IdleService({
    channelLayoutRepository: { get: async () => ({ discord: { bindings: [
      { enabled: true, featureKey: "monster_zone_event_1" },
      { enabled: true, featureKey: "monster_zone_beginner" },
    ] } }) },
    monsterService: { listMonsters: async ({ zone }) => {
      assert.equal(zone, "beginner", "Paused zone must not become an idle reward source");
      return [{ goldReward: 80, expReward: 200 }];
    } },
  });
  const idleOptions = await idle._buildDiscordZoneOptions(1);
  assert.deepEqual(idleOptions.map(option => option.zoneKey), ["beginner"]);
  console.log("Summer pause: hidden from public/admin lists, access and idle rotation blocked; normal/private zones preserved.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
