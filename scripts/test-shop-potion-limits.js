"use strict";
const assert = require("node:assert/strict");
const { ShopService } = require("../src/services/shop/shopService");
const { normalizeEnhanceGemStacks } = require("../src/shared/inventoryStacking");
const { validatePlan, freezePouch, listItems } = require("../src/services/tower/partyTowerPotions");
const { TOWER_POTION_IDS } = require("../src/bot/handlers/towerHandlers");

function fixture(itemId, { maxOwn = 0, inventory = [], gold = 100000, stock = -1 } = {}) {
  const info = TOWER_POTION_IDS[itemId];
  let item = { id: "shop-" + itemId, itemLibraryId: itemId, name: info.name,
    effect: info.effect, itemType: "consumable", enabled: true, price: 100, currency: "gold", stock, maxOwn };
  let progress = { playerId: "potion-test", inventory: structuredClone(inventory) };
  let balance = gold, charges = 0;
  const service = new ShopService({
    findById: async () => structuredClone(item),
    save: async next => { item = structuredClone(next); }
  }, { ensurePlayer: async () => ({ player: { discordId: progress.playerId } }) }, {
    grantCurrency: async ({ amount }) => {
      if (balance + amount < 0) throw new Error("餘額不足");
      balance += amount; charges++;
    }
  }, {
    findByPlayerId: async () => structuredClone(progress),
    save: async next => { progress = { ...structuredClone(next), inventory: normalizeEnhanceGemStacks(next.inventory) }; }
  });
  service.assertLinkedStreamAccount = async () => {};
  return { buy: n => service.purchase(progress.playerId, "測試", item.id, [], n),
    state: () => ({ progress: structuredClone(progress), balance, charges, stock: item.stock }) };
}

async function main() {
  const ids = Object.keys(TOWER_POTION_IDS), heal = ids[0];
  const revives = ids.filter(id => TOWER_POTION_IDS[id].effect.type === "tower_revive_pct");
  const entry = (id, n, suffix = "") => ({ uuid: id + suffix, itemId: id, itemType: "consumable", stackCount: n });
  for (const inventory of [[entry(heal, 3)], [entry(heal, 2), entry(heal, 1, "other")]]) {
    const capped = fixture(heal, { maxOwn: 3, inventory });
    const before = capped.state();
    await assert.rejects(() => capped.buy(1), /背包已有 3 個/);
    assert.deepEqual(capped.state(), before, "rejected ownership limit must not spend or alter inventory");
  }
  const capped = fixture(heal, { maxOwn: 3, inventory: [entry(heal, 1)] });
  await capped.buy(2);
  assert.equal(capped.state().progress.inventory[0].stackCount, 3);
  assert.equal(capped.state().balance, 99800);
  await assert.rejects(() => capped.buy(1), /背包已有 3 個/);

  for (const id of ids) {
    const shop = fixture(id);
    for (const n of [3, 2, 8]) await shop.buy(n);
    assert.equal(shop.state().progress.inventory.length, 1);
    assert.equal(shop.state().progress.inventory[0].stackCount, 13);
    assert.equal(shop.state().balance, 98700);
    await Promise.all([shop.buy(4), shop.buy(7)]);
    assert.equal(shop.state().progress.inventory[0].stackCount, 24);
    assert.equal(shop.state().balance, 97600);
    const before = shop.state();
    for (const n of [0, -1, 1.5, 1000, NaN, "invalid"]) await assert.rejects(() => shop.buy(n), /購買數量/);
    assert.deepEqual(shop.state(), before);
  }
  const poor = fixture(heal, { gold: 100, stock: 10 });
  const before = poor.state();
  await assert.rejects(() => poor.buy(2), /餘額不足/);
  assert.deepEqual(poor.state(), before, "failed debit must preserve stock and inventory");
  const limitedStock = fixture(heal, { stock: 3 });
  const purchases = await Promise.allSettled([limitedStock.buy(2), limitedStock.buy(2)]);
  assert.equal(purchases.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(limitedStock.state().stock, 1);
  assert.equal(limitedStock.state().balance, 99800);

  const inventory = [entry(heal, 20), ...revives.map(id => entry(id, 10))];
  assert.deepEqual(validatePlan({ [heal]: 8, [revives[0]]: 2 }, inventory), { [heal]: 8, [revives[0]]: 2 });
  assert.deepEqual(validatePlan({ [heal]: 10 }, inventory), { [heal]: 10 });
  assert.throws(() => validatePlan({ [heal]: 9, [revives[0]]: 2 }, inventory), /最多10瓶/);
  assert.throws(() => validatePlan({ [revives[0]]: 2, [revives[1]]: 1 }, inventory), /復活藥最多2瓶/);
  assert.throws(() => validatePlan({ [heal]: 21 }, inventory), /數量不足/);
  const member = { inventory, potionPlan: { [heal]: 8, [revives[0]]: 2 } };
  freezePouch(member);
  assert.equal(member.potionPouch.reduce((n, item) => n + item.remaining, 0), 10);
  assert.equal(listItems(member, inventory, true).find(item => item.itemId === heal).count, 20);
  assert.equal(listItems(member, inventory, false).find(item => item.itemId === heal).count, 8);
  console.log("PASS potion shop: stack-aware limits, five uncapped potions, exact charges, concurrent purchases, invalid quantities, insufficient funds and stock; 10 total/2 revives carried");
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
