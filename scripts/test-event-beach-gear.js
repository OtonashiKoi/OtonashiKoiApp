"use strict";

const assert = require("node:assert/strict");
const {
  BOSS_GEAR,
  BOSS_WEAPON_DROP_RATE,
  TURTLE_CARD_DROP_RATE,
  TURTLE_CARD_ID,
  buildBossDrops,
  buildItem,
} = require("./upsert-event-beach-gear");

const EXPECTED_WEAPON_TYPES = [
  "sword_1h", "sword_2h",
  "axe_1h", "axe_2h",
  "dagger", "dice",
  "mace_1h", "mace_2h",
  "staff_1h", "staff_2h",
  "bow",
].sort();

assert.equal(BOSS_GEAR.length, 11, "龜王 S 武器應為 11 種");
assert.deepEqual(BOSS_GEAR.map((g) => g.wType).sort(), EXPECTED_WEAPON_TYPES, "龜王武器類型不完整");
assert.equal(new Set(BOSS_GEAR.map((g) => g.id)).size, BOSS_GEAR.length, "龜王武器 id 重複");
assert.equal(BOSS_WEAPON_DROP_RATE, 9, "11 把武器應各佔 9%");
assert.equal(TURTLE_CARD_DROP_RATE, 1, "龜王卡應佔 1%");

for (const gear of BOSS_GEAR) {
  const item = buildItem(gear, "S", { element: "water", chancePct: 100, minLevel: 2, maxLevel: 3 });
  assert.equal(Object.values(item.equipStats).reduce((sum, value) => sum + value, 0), gear.base, `${gear.name} 屬性總和錯誤`);
  assert.equal(item.elementDrop.element, "water", `${gear.name} 不是水屬性`);
  assert.equal(item.elementDrop.minLevel, 2, `${gear.name} 最低濃度錯誤`);
  assert.equal(item.elementDrop.maxLevel, 3, `${gear.name} 最高濃度錯誤`);
  assert.equal(item.setKey, "island_turtle", `${gear.name} 應計入龜王套裝`);
  assert.deepEqual(item.setKeys, ["island_turtle"], `${gear.name} 套裝歸屬錯誤`);
  assert.match(item.imageUrl, /\/item-art\/generated\/2026-08-05\/.+\.png$/, `${gear.name} 應有可用圖片`);
  if (item.weaponType === "dice") {
    assert.equal(item.isTwoHanded, true, `${gear.name} 應為雙手武器`);
    assert.equal(item.atkStat, "luk", `${gear.name} 應以 LUK 為主屬性`);
  }
}

const drops = buildBossDrops([
  { itemId: "beach-s-old", chance: 99 },
  { itemId: TURTLE_CARD_ID, chance: 50 },
  { itemId: "gem-s-tier", chance: 2 },
]);
assert.equal(drops.filter((d) => d.itemId === TURTLE_CARD_ID).length, 1, "龜王卡應只有一筆");
assert.equal(drops.find((d) => d.itemId === TURTLE_CARD_ID).chance, 1, "龜王卡機率應重設為 1%");
assert.equal(drops.filter((d) => String(d.itemId).startsWith("beach-s-")).length, 11, "獎池應有 11 把龜王 S 武器");
assert.ok(drops.some((d) => d.itemId === "gem-s-tier"), "非本腳本管理的掉落不可被移除");
assert.equal(
  drops.filter((d) => d.itemId === TURTLE_CARD_ID || String(d.itemId).startsWith("beach-s-"))
    .reduce((sum, d) => sum + d.chance, 0),
  100,
  "龜王卡與武器權重應合計 100%",
);

console.log("✅ 龜王海灘 S 武器：11 種齊全，龜王卡 1%，每把武器 9%");
