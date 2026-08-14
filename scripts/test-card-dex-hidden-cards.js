"use strict";

const assert = require("node:assert/strict");
const { getCardRegistry } = require("../src/shared/cardDex");

const cards = [
  {
    id: "visible-card",
    name: "公開怪物卡",
    equipSlot: "special",
    monsterCardOf: "visible-monster",
    monsterCardSkill: { name: "公開技能" },
  },
  {
    id: "hidden-preview-card",
    name: "未公開活動卡",
    equipSlot: "special",
    monsterCardOf: "hidden-monster",
    monsterCardSkill: { name: "私測技能" },
    bestiaryVisible: false,
  },
];

const monsters = [
  { id: "visible-monster", name: "公開怪物", zone: "normal" },
  { id: "hidden-monster", name: "未公開怪物", zone: "event_boss_hutao_preview" },
];

const fakeDb = {
  collection(name) {
    if (name === "items") {
      return { find: () => ({ toArray: async () => cards }) };
    }
    if (name === "monsters") {
      return { find: () => ({ project: () => ({ toArray: async () => monsters }) }) };
    }
    throw new Error(`unexpected collection: ${name}`);
  },
};

(async () => {
  const registry = await getCardRegistry(fakeDb, { force: true });
  assert.equal(registry.totalCards, 1);
  assert.equal(Boolean(registry.byId["visible-card"]), true);
  assert.equal(Boolean(registry.byId["hidden-preview-card"]), false);
  assert.equal(registry.groups.some((group) => group.key === "event_boss_hutao_preview"), false);
  console.log("未公開卡片不會進入卡片圖鑑登錄表。" );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
