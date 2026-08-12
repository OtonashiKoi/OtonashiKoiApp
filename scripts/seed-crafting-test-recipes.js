#!/usr/bin/env node
"use strict";

require("dotenv").config();
const { OWNER_TESTER_ID } = require("../src/shared/craftingAccess");
const { ENHANCE_GEMS } = require("../src/shared/enhanceConfig");

const apply = process.argv.includes("--apply");
const now = new Date().toISOString();
const RETIRED_TEST_RECIPE_IDS = [
  "craft-test-water-fire-d",
  "craft-test-seven-elements-c",
  "craft-test-gem-d-to-c"
];

function ownerTestRecipe({ id, name, description, category, categoryLabel, inputId, outputId, sortOrder }) {
  return {
    id,
    name,
    description,
    category,
    categoryLabel,
    inputs: [{ itemId: inputId, quantity: 5 }],
    outputs: [{ itemId: outputId, quantity: 1 }],
    goldCost: 0,
    maxBatch: 99,
    accessMode: "owner_test",
    testerIds: [OWNER_TESTER_ID],
    testOnly: true,
    enabled: true,
    sortOrder,
    createdAt: now,
    updatedAt: now
  };
}

const recipes = [
  ownerTestRecipe({ id: "craft-gem-d-to-c", name: "寶石升階・D → C", description: "5 顆 D階寶石合成 1 顆 C階寶石。", category: "gem-upgrade", categoryLabel: "寶石升階", inputId: ENHANCE_GEMS.D, outputId: ENHANCE_GEMS.C, sortOrder: 10 }),
  ownerTestRecipe({ id: "craft-gem-c-to-b", name: "寶石升階・C → B", description: "5 顆 C階寶石合成 1 顆 B階寶石。", category: "gem-upgrade", categoryLabel: "寶石升階", inputId: ENHANCE_GEMS.C, outputId: ENHANCE_GEMS.B, sortOrder: 20 }),
  ownerTestRecipe({ id: "craft-gem-b-to-a", name: "寶石升階・B → A", description: "5 顆 B階寶石合成 1 顆 A階寶石。", category: "gem-upgrade", categoryLabel: "寶石升階", inputId: ENHANCE_GEMS.B, outputId: ENHANCE_GEMS.A, sortOrder: 30 }),

  ownerTestRecipe({ id: "craft-element-wood-to-fire", name: "五行相生・木 → 火", description: "木生火：5 顆木屬性石轉換為 1 顆火屬性石。", category: "element-convert", categoryLabel: "屬性轉換", inputId: "element-stone-wood", outputId: "element-stone-fire", sortOrder: 110 }),
  ownerTestRecipe({ id: "craft-element-fire-to-earth", name: "五行相生・火 → 土", description: "火生土：5 顆火屬性石轉換為 1 顆土屬性石。", category: "element-convert", categoryLabel: "屬性轉換", inputId: "element-stone-fire", outputId: "element-stone-earth", sortOrder: 120 }),
  ownerTestRecipe({ id: "craft-element-earth-to-metal", name: "五行相生・土 → 金", description: "土生金：5 顆土屬性石轉換為 1 顆金屬性石。", category: "element-convert", categoryLabel: "屬性轉換", inputId: "element-stone-earth", outputId: "element-stone-metal", sortOrder: 130 }),
  ownerTestRecipe({ id: "craft-element-metal-to-water", name: "五行相生・金 → 水", description: "金生水：5 顆金屬性石轉換為 1 顆水屬性石。", category: "element-convert", categoryLabel: "屬性轉換", inputId: "element-stone-metal", outputId: "element-stone-water", sortOrder: 140 }),
  ownerTestRecipe({ id: "craft-element-water-to-wood", name: "五行相生・水 → 木", description: "水生木：5 顆水屬性石轉換為 1 顆木屬性石。", category: "element-convert", categoryLabel: "屬性轉換", inputId: "element-stone-water", outputId: "element-stone-wood", sortOrder: 150 }),
  ownerTestRecipe({ id: "craft-element-sun-to-moon", name: "日月轉換・日 → 月", description: "5 顆日屬性石轉換為 1 顆月屬性石。", category: "element-convert", categoryLabel: "屬性轉換", inputId: "element-stone-sun", outputId: "element-stone-moon", sortOrder: 160 }),
  ownerTestRecipe({ id: "craft-element-moon-to-sun", name: "日月轉換・月 → 日", description: "5 顆月屬性石轉換為 1 顆日屬性石。", category: "element-convert", categoryLabel: "屬性轉換", inputId: "element-stone-moon", outputId: "element-stone-sun", sortOrder: 170 })
];

async function main() {
  console.log(`${apply ? "APPLY" : "DRY RUN"}: ${recipes.length} 個音無恋限定合成配方`);
  for (const recipe of recipes) console.log(`- ${recipe.id}: ${recipe.name}`);
  if (!apply) {
    console.log("未寫入資料庫；確認後加上 --apply。");
    return;
  }
  const { createRepositories } = require("../src/repositories/createRepositories");
  const { closeMongoClient } = require("../src/adapters/mongo/createMongoClient");
  try {
    const repositories = createRepositories();
    for (const recipe of recipes) await repositories.craftingRepository.saveRecipe(recipe);
    await repositories.craftingRepository.disableRecipes(RETIRED_TEST_RECIPE_IDS, "replaced_by_owner_recipe_table_v1");
    console.log("合成表已寫入 craftingRecipes；舊功能測試配方已停用但未刪除。其他玩家仍無法取得或執行。");
  } finally {
    await closeMongoClient().catch(() => {});
  }
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = { recipes, RETIRED_TEST_RECIPE_IDS };
