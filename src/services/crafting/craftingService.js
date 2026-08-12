"use strict";

const { randomUUID } = require("crypto");
const { AppError, ERROR_CODES } = require("../../shared/errors");
const { isCraftingTester } = require("../../shared/craftingAccess");
const { withPlayerProgressLock } = require("../progress/progressLocks");

const MAX_CRAFT_QUANTITY = 99;
const MAX_CONFLICT_RETRIES = 3;

function positiveInt(value, fallback = 1) {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function stackCountOf(entry) {
  return Math.max(1, Math.trunc(Number(entry?.stackCount) || 1));
}

function countAvailable(inventory, itemId) {
  return (Array.isArray(inventory) ? inventory : []).reduce((sum, entry) => {
    if (!entry || entry.locked || String(entry.itemId || "") !== String(itemId || "")) return sum;
    return sum + stackCountOf(entry);
  }, 0);
}

function consumeItem(inventory, itemId, amount) {
  let remaining = positiveInt(amount);
  for (let i = inventory.length - 1; i >= 0 && remaining > 0; i -= 1) {
    const entry = inventory[i];
    if (!entry || entry.locked || String(entry.itemId || "") !== String(itemId || "")) continue;
    const count = stackCountOf(entry);
    const consumed = Math.min(count, remaining);
    remaining -= consumed;
    if (consumed >= count) inventory.splice(i, 1);
    else inventory[i] = { ...entry, stackCount: count - consumed };
  }
  return remaining === 0;
}

function isStackableDefinition(item) {
  const type = String(item?.itemType || "").toLowerCase();
  if (item?.monsterCardOf || item?.monsterCardSkill || type === "monster_card") return false;
  return type === "consumable" || type === "material" || type === "pet_egg";
}

function buildInventoryEntry(item, quantity, sourceRef) {
  const now = new Date().toISOString();
  return {
    uuid: randomUUID(),
    itemId: item.id,
    itemName: item.name || "未命名成品",
    name: item.name || "未命名成品",
    itemEffect: item.effect || { type: "none", value: 0 },
    itemType: item.itemType || "material",
    equipSlot: item.equipSlot || null,
    equipStats: item.equipStats ? { ...item.equipStats } : null,
    weaponType: item.weaponType || null,
    isTwoHanded: Boolean(item.isTwoHanded),
    atkStat: item.atkStat || null,
    tier: item.tier || null,
    setKey: item.setKey || null,
    setKeys: Array.isArray(item.setKeys) ? [...item.setKeys] : (item.setKey ? [item.setKey] : []),
    monsterCardOf: item.monsterCardOf || null,
    monsterCardSkill: item.monsterCardSkill || null,
    enhanceLevel: 0,
    ...(isStackableDefinition(item) ? { stackCount: positiveInt(quantity) } : {}),
    source: "crafting",
    sourceRef,
    craftedAt: now,
    purchasedAt: now
  };
}

function addOutput(inventory, item, quantity, sourceRef) {
  const qty = positiveInt(quantity);
  if (isStackableDefinition(item)) {
    const existingIndex = inventory.findIndex((entry) =>
      entry && !entry.locked && String(entry.itemId || "") === String(item.id)
    );
    if (existingIndex >= 0) {
      const existing = inventory[existingIndex];
      inventory[existingIndex] = {
        ...existing,
        stackCount: stackCountOf(existing) + qty,
        source: existing.source || "crafting"
      };
    } else {
      inventory.push(buildInventoryEntry(item, qty, sourceRef));
    }
    return;
  }
  for (let i = 0; i < qty; i += 1) inventory.push(buildInventoryEntry(item, 1, sourceRef));
}

class CraftingService {
  constructor({ craftingRepository, progressRepository, walletRepository, itemRepository }) {
    this.craftingRepository = craftingRepository;
    this.progressRepository = progressRepository;
    this.walletRepository = walletRepository;
    this.itemRepository = itemRepository;
  }

  _assertTester(discordId) {
    if (!isCraftingTester(discordId)) {
      throw new AppError(ERROR_CODES.CRAFTING_TEST_ONLY, "合成系統目前只開放指定測試帳號。", 403);
    }
  }

  _canAccessRecipe(discordId, recipe) {
    if (!recipe?.enabled) return false;
    if (recipe.accessMode === "public") return true;
    return recipe.accessMode === "owner_test"
      && Array.isArray(recipe.testerIds)
      && recipe.testerIds.map(String).includes(String(discordId));
  }

  async _loadItemMap(recipes) {
    const ids = new Set();
    for (const recipe of recipes) {
      for (const input of recipe.inputs || []) if (input?.itemId) ids.add(String(input.itemId));
      for (const output of recipe.outputs || []) if (output?.itemId) ids.add(String(output.itemId));
    }
    const rows = await Promise.all([...ids].map((id) => this.itemRepository.findById(id)));
    return new Map(rows.filter(Boolean).map((item) => [String(item.id), item]));
  }

  async getPlayerState(discordId) {
    this._assertTester(discordId);
    const [recipes, progress, wallet] = await Promise.all([
      this.craftingRepository.listAccessible(discordId),
      this.progressRepository.findByPlayerId(discordId),
      this.walletRepository.findByPlayerId(discordId)
    ]);
    const inventory = Array.isArray(progress?.inventory) ? progress.inventory : [];
    const itemMap = await this._loadItemMap(recipes);
    const gold = Math.max(0, Number(wallet?.gold) || 0);

    const viewRecipes = recipes.map((recipe) => {
      const inputs = (recipe.inputs || []).map((input) => {
        const item = itemMap.get(String(input.itemId));
        const required = positiveInt(input.quantity);
        const owned = countAvailable(inventory, input.itemId);
        return {
          itemId: String(input.itemId),
          name: item?.name || input.name || "未知道具",
          imageUrl: item?.imageUrl || item?.imageThumbnailUrl || null,
          tier: item?.tier || null,
          required,
          owned,
          sufficient: owned >= required
        };
      });
      const outputs = (recipe.outputs || []).map((output) => {
        const item = itemMap.get(String(output.itemId));
        return {
          itemId: String(output.itemId),
          name: item?.name || output.name || "未知成品",
          imageUrl: item?.imageUrl || item?.imageThumbnailUrl || null,
          tier: item?.tier || null,
          quantity: positiveInt(output.quantity)
        };
      });
      const materialMax = inputs.length
        ? Math.min(...inputs.map((input) => Math.floor(input.owned / input.required)))
        : 0;
      const goldCost = Math.max(0, Math.trunc(Number(recipe.goldCost) || 0));
      const goldMax = goldCost > 0 ? Math.floor(gold / goldCost) : MAX_CRAFT_QUANTITY;
      const maxBatch = Math.min(MAX_CRAFT_QUANTITY, positiveInt(recipe.maxBatch, MAX_CRAFT_QUANTITY));
      const maxCraftable = Math.max(0, Math.min(materialMax, goldMax, maxBatch));
      let blockedReason = null;
      if (!inputs.length || !outputs.length) blockedReason = "配方資料尚未完整";
      else if (inputs.some((input) => !itemMap.has(input.itemId)) || outputs.some((output) => !itemMap.has(output.itemId))) blockedReason = "配方引用的道具不存在";
      else if (materialMax <= 0) blockedReason = "素材不足";
      else if (goldMax <= 0) blockedReason = "金幣不足";

      return {
        id: recipe.id,
        name: recipe.name || "未命名配方",
        description: recipe.description || "",
        category: recipe.category || "other",
        categoryLabel: recipe.categoryLabel || "其他",
        testOnly: Boolean(recipe.testOnly),
        goldCost,
        maxBatch,
        maxCraftable: blockedReason ? 0 : maxCraftable,
        canCraft: !blockedReason && maxCraftable > 0,
        blockedReason,
        inputs,
        outputs
      };
    });

    return {
      testMode: true,
      testerId: String(discordId),
      gold,
      recipes: viewRecipes
    };
  }

  async craft(discordId, recipeId, quantity = 1) {
    this._assertTester(discordId);
    const qty = Math.trunc(Number(quantity));
    if (!Number.isFinite(qty) || qty < 1 || qty > MAX_CRAFT_QUANTITY) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `合成數量必須是 1～${MAX_CRAFT_QUANTITY} 的整數。`, 400);
    }

    return withPlayerProgressLock(discordId, async () => {
      const recipe = await this.craftingRepository.findRecipeById(recipeId);
      if (!this._canAccessRecipe(discordId, recipe)) {
        throw new AppError(ERROR_CODES.CRAFTING_RECIPE_NOT_FOUND, "找不到可使用的合成配方。", 404);
      }
      const maxBatch = Math.min(MAX_CRAFT_QUANTITY, positiveInt(recipe.maxBatch, MAX_CRAFT_QUANTITY));
      if (qty > maxBatch) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `這個配方一次最多合成 ${maxBatch} 次。`, 400);
      }
      if (!Array.isArray(recipe.inputs) || recipe.inputs.length === 0 || !Array.isArray(recipe.outputs) || recipe.outputs.length === 0) {
        throw new AppError(ERROR_CODES.CRAFTING_RECIPE_INVALID, "這個配方尚未設定完整。", 409);
      }

      const itemMap = await this._loadItemMap([recipe]);
      for (const line of [...recipe.inputs, ...recipe.outputs]) {
        if (!itemMap.has(String(line.itemId))) {
          throw new AppError(ERROR_CODES.CRAFTING_RECIPE_INVALID, "配方引用的道具不存在，已停止合成。", 409);
        }
      }

      for (let attempt = 1; attempt <= MAX_CONFLICT_RETRIES; attempt += 1) {
        const [progress, wallet] = await Promise.all([
          this.progressRepository.findByPlayerId(discordId),
          this.walletRepository.findByPlayerId(discordId)
        ]);
        if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到玩家背包資料。", 404);
        const inventory = Array.isArray(progress.inventory)
          ? progress.inventory.map((entry) => ({ ...entry }))
          : [];
        const goldCost = Math.max(0, Math.trunc(Number(recipe.goldCost) || 0)) * qty;
        if ((Number(wallet?.gold) || 0) < goldCost) {
          throw new AppError(ERROR_CODES.INSUFFICIENT_BALANCE, `金幣不足，需要 ${goldCost.toLocaleString()} 金幣。`, 400);
        }

        for (const input of recipe.inputs) {
          const needed = positiveInt(input.quantity) * qty;
          const owned = countAvailable(inventory, input.itemId);
          if (owned < needed) {
            const item = itemMap.get(String(input.itemId));
            throw new AppError(
              ERROR_CODES.INSUFFICIENT_MATERIALS,
              `${item?.name || "素材"}不足，需要 ${needed}、目前可用 ${owned}。`,
              400
            );
          }
        }

        for (const input of recipe.inputs) {
          consumeItem(inventory, input.itemId, positiveInt(input.quantity) * qty);
        }

        const transactionId = randomUUID();
        for (const output of recipe.outputs) {
          addOutput(
            inventory,
            itemMap.get(String(output.itemId)),
            positiveInt(output.quantity) * qty,
            transactionId
          );
        }

        let result;
        try {
          result = await this.craftingRepository.executeCraftAtomic({
            playerId: discordId,
            expectedSeasonKey: progress.seasonKey,
            expectedUpdatedAt: progress.updatedAt,
            nextInventory: inventory,
            goldCost,
            transaction: {
              id: transactionId,
              recipeId: recipe.id,
              recipeName: recipe.name || recipe.id,
              quantity: qty,
              inputs: recipe.inputs.map((line) => ({ itemId: line.itemId, quantity: positiveInt(line.quantity) * qty })),
              outputs: recipe.outputs.map((line) => ({ itemId: line.itemId, quantity: positiveInt(line.quantity) * qty })),
              testOnly: Boolean(recipe.testOnly)
            }
          });
        } catch (error) {
          if (error?.code === "INSUFFICIENT_CRAFTING_GOLD") {
            throw new AppError(ERROR_CODES.INSUFFICIENT_BALANCE, "金幣餘額剛剛發生變動，請重新確認。", 409);
          }
          throw error;
        }
        if (!result?.ok && result?.reason === "progress_conflict") continue;
        if (!result?.ok) throw new Error("CRAFTING_TRANSACTION_FAILED");

        const craftedOutputs = recipe.outputs.map((line) => {
          const item = itemMap.get(String(line.itemId));
          return { itemId: line.itemId, name: item?.name || "成品", quantity: positiveInt(line.quantity) * qty };
        });
        return {
          transactionId,
          recipeId: recipe.id,
          recipeName: recipe.name || recipe.id,
          quantity: qty,
          goldSpent: goldCost,
          outputs: craftedOutputs,
          state: await this.getPlayerState(discordId)
        };
      }

      throw new AppError("CRAFTING_CONFLICT", "背包剛剛有其他變動，請再試一次。", 409);
    });
  }
}

module.exports = {
  CraftingService,
  MAX_CRAFT_QUANTITY,
  countAvailable,
  consumeItem,
  addOutput
};
