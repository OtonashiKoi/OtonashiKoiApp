"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture({ count = 0, tier = null, bonus = 0, season = 0, blockedMembership = false, testAccount = false } = {}) {
  const inventory = Array.from({ length: count }, () => ({ itemType: "equipment", equipSlot: "armor" }));
  let membershipReads = 0, walletReads = 0;
  const serviceContext = {
    progressRepository: { findByPlayerId: async () => ({ inventory, playerTier: tier, isTestAccount: testAccount }) },
    streamAccountBindingRepository: { listByDiscordId: async () => {
      membershipReads++;
      if (blockedMembership) throw Error("Under-base-capacity battle must never request membership");
      return [];
    } },
    walletRepository: { findByPlayerId: async () => { walletReads++; return { bonusBackpackSlots: bonus, seasonBackpackSlots: season }; } },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/services/backpack/backpackService.js"), "utf8"), {
    module, exports: module.exports,
    require: name => {
      if (name === "../../config") return { discord: {} };
      if (name === "../../bot/runtimeContext") return { serviceContext, getBotClient: () => null };
      if (name === "../../shared/errors") return { AppError: Error, ERROR_CODES: {} };
      throw Error("Unexpected dependency " + name);
    },
  });
  return { service: module.exports, inventory, reads: () => ({ membershipReads, walletReads }) };
}

(async () => {
  for (const count of [0, 1, 149]) {
    const f = fixture({ count, blockedMembership: true });
    assert.equal(await f.service.checkBackpackFullForBattle("p"), null);
    assert.deepEqual(f.reads(), { membershipReads: 0, walletReads: 0 });
  }
  const mixed = fixture({ count: 149 });
  mixed.inventory.push(...Array.from({ length: 500 }, () => ({ itemType: "material" })), { itemType: "equipment", equipSlot: "special", isNpcCard: true });
  assert.equal(await mixed.service.checkBackpackFullForBattle("p", mixed.inventory), null);
  assert.equal(mixed.reads().membershipReads, 0, "non-capacity items do not force a membership request");
  for (const test of [
    { count: 150, full: true, cap: 150 },
    { count: 150, tier: "C", full: false },
    { count: 299, tier: "C", full: false },
    { count: 300, tier: "C", full: true, cap: 300 },
    { count: 150, bonus: 20, full: false },
    { count: 170, bonus: 20, full: true, cap: 170 },
    { count: 150, season: 20, full: false },
    { count: 150, testAccount: true, full: false },
    { count: 2000, testAccount: true, full: true, cap: 2000 },
  ]) {
    const f = fixture(test), result = await f.service.checkBackpackFullForBattle("p");
    assert.equal(Boolean(result), test.full, JSON.stringify(test));
    if (test.full) assert.equal(result.cap, test.cap);
    assert.equal(f.reads().membershipReads, 1, "capacity boundary retains the authoritative membership check");
  }
  console.log("PASS battle start capacity: 0/1/149 skip membership and wallet; material/card exclusions; 150/300 boundaries; permanent/season slots; test-account capacity");
})().catch(error => { console.error(error); process.exitCode = 1; });
