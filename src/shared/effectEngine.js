const { randomUUID } = require("crypto");
const { normalizeActiveEffect, normalizeActiveEffectList } = require("./effectPayloads");

const STAT_EFFECT_MAP = {
  max_hp_up: { stat: "maxHp", mode: "add", amount: 50 },
  max_hp_down: { stat: "maxHp", mode: "add", amount: -50 },
  agi_up: { stat: "agi", mode: "add", amount: 3 },
  agi_down: { stat: "agi", mode: "add", amount: -3 },
  atk_up: { stat: "atk", mode: "add", amount: 10 },
  atk_down: { stat: "atk", mode: "add", amount: -10 },
  def_up: { stat: "def", mode: "add", amount: 5 },
  def_down: { stat: "def", mode: "add", amount: -5 },
  mdef_up: { stat: "mdef", mode: "add", amount: 5 },
  mdef_down: { stat: "mdef", mode: "add", amount: -5 },
  hit_up: { stat: "hit", mode: "add", amount: 8 },
  hit_down: { stat: "hit", mode: "add", amount: -8 },
  dodge_up: { stat: "dodge", mode: "add", amount: 8 },
  dodge_down: { stat: "dodge", mode: "add", amount: -8 },
  crit_rate_up: { stat: "crit", mode: "add", amount: 5 },
  crit_rate_down: { stat: "crit", mode: "add", amount: -5 },
  crit_damage_up: { stat: "critDamage", mode: "mul", amount: 1.2 },
  crit_damage_down: { stat: "critDamage", mode: "mul", amount: 0.85 },
  speed_up: { stat: "speed", mode: "add", amount: 10 },
  speed_down: { stat: "speed", mode: "add", amount: -10 },
  atk_multiplier_up: { stat: "atk", mode: "mul", amount: 1.2 },
  def_multiplier_up: { stat: "def", mode: "mul", amount: 1.1 },
  max_hp_multiplier_up: { stat: "maxHp", mode: "mul", amount: 1.1 },
  block_chance_up: { stat: "blockChance", mode: "add", amount: 10 },
  combo_damage_up: { stat: "comboDamageMultiplier", mode: "mul", amount: 1.1 },
  combo_up: { stat: "combo", mode: "add", amount: 5 },
  stun_chance_up: { stat: "stunChance", mode: "add", amount: 10 },
  execute_chance_up: { stat: "executeChance", mode: "add", amount: 10 },
  execute_threshold_up: { stat: "executeThresholdPct", mode: "add", amount: 10 },
  final_damage_up: { stat: "finalDamageMultiplier", mode: "mul", amount: 1.15 },
  final_damage_down: { stat: "finalDamageMultiplier", mode: "mul", amount: 0.85 }
};

const CONTROL_KEYS = new Set(["stun", "freeze", "sleep", "silence", "root", "slow", "blind", "taunt", "fear", "confuse", "disarm"]);
const DOT_KEYS = new Set(["poison", "burn", "bleed", "shock_dot", "curse_dot", "heal_over_time", "life_regen", "mana_regen"]);

function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeConditionValues(input) {
  if (input === undefined || input === null) return [];
  if (Array.isArray(input)) return input.map((value) => String(value || "").trim()).filter(Boolean);
  const value = String(input || "").trim();
  return value ? [value] : [];
}

function matchConditionValues(input, matcher) {
  const values = normalizeConditionValues(input);
  if (values.length === 0) return true;
  return values.some(matcher);
}

function matchNotConditionValues(input, matcher) {
  const values = normalizeConditionValues(input);
  if (values.length === 0) return true;
  return values.every((value) => !matcher(value));
}

function isEffectConditionMet(effectRef, context = {}) {
  const condition = effectRef?.condition;
  if (!condition || typeof condition !== "object") return true;

  const equipped = (context.equipped && typeof context.equipped === "object") ? context.equipped : {};
  const inventory = Array.isArray(context.inventory) ? context.inventory : [];
  const equippedEntries = Object.entries(equipped).filter(([, entry]) => entry && typeof entry === "object");
  const equippedItemIds = new Set(equippedEntries.map(([, entry]) => entry.itemId).filter(Boolean));
  const equippedSlots = new Set(equippedEntries.map(([slot]) => slot).filter(Boolean));
  const inventoryItemIds = new Set(inventory.map((entry) => entry?.itemId).filter(Boolean));

  const hasItemId = (itemId) => equippedItemIds.has(itemId) || inventoryItemIds.has(itemId);
  const hasInventoryItemId = (itemId) => inventoryItemIds.has(itemId);
  const hasEquippedItemId = (itemId) => equippedItemIds.has(itemId);
  const hasEquippedSlot = (slot) => equippedSlots.has(slot);
  const hasWeaponType = (weaponType) => {
    if (!weaponType) return false;
    const mainWeaponType = equipped?.weapon?.weaponType || null;
    const offhandWeaponType = equipped?.shield?.weaponType || null;
    return mainWeaponType === weaponType || offhandWeaponType === weaponType;
  };

  if (Array.isArray(condition.all) && condition.all.length > 0) {
    const allMatch = condition.all.every((sub) => isEffectConditionMet({ condition: sub }, context));
    if (!allMatch) return false;
  }
  if (Array.isArray(condition.any) && condition.any.length > 0) {
    const anyMatch = condition.any.some((sub) => isEffectConditionMet({ condition: sub }, context));
    if (!anyMatch) return false;
  }

  if (!matchConditionValues(condition.hasItemId, hasItemId)) return false;
  if (!matchConditionValues(condition.hasInventoryItemId, hasInventoryItemId)) return false;
  if (!matchConditionValues(condition.hasUnequippedItemId, hasInventoryItemId)) return false;
  if (!matchConditionValues(condition.equippedItemId, hasEquippedItemId)) return false;
  if (!matchConditionValues(condition.equippedSlot, hasEquippedSlot)) return false;
  if (!matchConditionValues(condition.weaponType, hasWeaponType)) return false;

  // zone 條件：限定在特定戰鬥區才生效（context.zone 由戰鬥端傳入；非戰鬥情境無 zone 則不符合）
  if (condition.zone !== undefined && condition.zone !== null && condition.zone !== "") {
    const ctxZone = context.zone ? String(context.zone) : null;
    const matchZone = ctxZone !== null && matchConditionValues(condition.zone, (z) => z === ctxZone);
    if (!matchZone) return false;
  }

  if (!matchNotConditionValues(condition.notHasItemId, hasItemId)) return false;
  if (!matchNotConditionValues(condition.notEquippedItemId, hasEquippedItemId)) return false;
  if (!matchNotConditionValues(condition.notEquippedSlot, hasEquippedSlot)) return false;
  if (!matchNotConditionValues(condition.notWeaponType, hasWeaponType)) return false;

  return true;
}

function collectEffectRefsFromEntry(entry, trigger = null, context = {}) {
  if (!entry || typeof entry !== "object") return [];
  // 附魔的衍生詞條(有 effectKey 的)→ 視為裝備 passive 效果，一併進入效果管線
  // （基礎屬性詞條無 effectKey，不在此，另在 calcPlayerStats 直接加屬性）
  const enchantEffects = Array.isArray(entry.enchantments)
    ? entry.enchantments
        .filter((e) => e && e.effectKey)
        .map((e) => ({ key: e.effectKey, trigger: "passive", params: { value: Number(e.value) || 0 }, source: "enchant" }))
    : [];
  const buckets = [
    ...(Array.isArray(entry.passiveEffects) ? entry.passiveEffects : []),
    ...(Array.isArray(entry.procEffects) ? entry.procEffects : []),
    ...(Array.isArray(entry.useEffects) ? entry.useEffects : []),
    ...(Array.isArray(entry.combatEffects) ? entry.combatEffects : []),
    ...enchantEffects
  ];
  return buckets.filter((effect) => {
    if (!effect || typeof effect !== "object") return false;
    if (trigger && effect.trigger !== trigger) return false;
    return isEffectConditionMet(effect, context);
  });
}

function collectEquipmentEffects(equipped, trigger = null, context = {}) {
  const itemEffects = Object.values(equipped || {}).flatMap((entry) => collectEffectRefsFromEntry(entry, trigger, context));
  // 具名套裝效果（達門檻才產生；帶 condition，交由 isEffectConditionMet 判定 zone 等）
  let setEffects = [];
  try {
    const { getSetEffects } = require("./equipmentSetBonuses");
    setEffects = getSetEffects(equipped).filter((effect) => {
      if (!effect || typeof effect !== "object") return false;
      if (trigger && effect.trigger !== trigger) return false;
      return isEffectConditionMet(effect, context);
    });
  } catch (_) { /* 套裝模組缺失時不影響戰鬥 */ }
  return [...itemEffects, ...setEffects];
}

// ─────────────────────────────────────────────────────────────────────────────
// 動態合併裝備 Effects（永遠從 DB 讀取，不用 snapshot）
//
// 原則：玩家身上的裝備 snapshot 只保留「玩家自有資料」：
//   uuid、itemId、itemName、enhanceLevel、tier、purchasedAt、grantedAt 等。
// 所有「設計資料」（passiveEffects、combatEffects、procEffects、useEffects、
//   equipStats、weaponType、isTwoHanded）永遠從 items collection 動態讀取。
// 這樣 DB 一改，所有玩家下一場戰鬥就自動套用新值，不需要跑修正腳本。
// ─────────────────────────────────────────────────────────────────────────────
async function mergeEquippedFromLibrary(equipped, itemRepository) {
  if (!equipped || !itemRepository) return equipped || {};
  const slots = Object.keys(equipped);
  if (slots.length === 0) return equipped;

  // 收集所有需要查詢的 itemId（去重）
  const itemIds = [...new Set(
    slots.map(s => equipped[s]?.itemId).filter(Boolean)
  )];
  if (itemIds.length === 0) return equipped;

  // 批量查詢（減少 DB round-trip）
  let libMap = {};
  try {
    const results = await Promise.all(
      itemIds.map(id => itemRepository.findById(id).catch(() => null))
    );
    itemIds.forEach((id, i) => { if (results[i]) libMap[id] = results[i]; });
  } catch (e) {
    // DB 查詢失敗時 fallback 用 snapshot，戰鬥不中斷
    return equipped;
  }

  // 用 DB 最新值覆蓋設計欄位
  const merged = {};
  for (const slot of slots) {
    const entry = equipped[slot];
    if (!entry) { merged[slot] = entry; continue; }
    const lib = libMap[entry.itemId];
    if (!lib) { merged[slot] = entry; continue; }

    // equipStats：優先用玩家背包的已強化值（enhanceService 已正確計算）
    // 若背包沒有，才從 library 讀原始基礎值（防舊資料）
    let equipStats = entry.equipStats || lib.equipStats || null;

    merged[slot] = {
      ...entry,
      passiveEffects: lib.passiveEffects || [],
      combatEffects:  lib.combatEffects  || [],
      procEffects:    lib.procEffects    || [],
      useEffects:     lib.useEffects     || [],
      jobSkills:      lib.jobSkills      || entry.jobSkills || [],
      equipStats,
      weaponType:     lib.weaponType     || entry.weaponType || null,
      isTwoHanded:    lib.isTwoHanded    ?? entry.isTwoHanded ?? false,
      monsterCardSkill: lib.monsterCardSkill || entry.monsterCardSkill || null,
      // 確保 name / itemName 以 DB 為準（DB 欄位是 name，snapshot 可能只有 itemName）
      name:     lib.name     || entry.name     || entry.itemName || null,
      itemName: lib.name     || entry.itemName || entry.name     || null,
      // 帶 DB 最新中文說明（snapshot 常缺 description，戒指特性等顯示要用）
      description: lib.description ?? entry.description ?? null,
      // 圖片以道具庫最新為準（更新庫圖後，舊實例快照不再顯示舊圖）
      imageUrl: lib.imageUrl || entry.imageUrl || null,
      imageThumbnailUrl: lib.imageThumbnailUrl || entry.imageThumbnailUrl || null,
    };
  }
  return merged;
}


function createRuntimeEffect(effectRef, source = {}) {
  return normalizeActiveEffect({
    ...effectRef,
    id: source.id || randomUUID(),
    source: source.source || source.sourceType || "system",
    sourceType: source.sourceType || "system",
    sourceId: source.sourceId || null,
    remaining: effectRef.duration,
    createdAt: new Date().toISOString()
  });
}

function applyEffectsToStats(baseStats, effectRefs = [], context = {}) {
  const result = { ...baseStats };
  if (!Number.isFinite(result.critDamage)) result.critDamage = 2.5;
  if (!Number.isFinite(result.finalDamageMultiplier)) result.finalDamageMultiplier = 1;
  if (!Number.isFinite(result.speed)) result.speed = 100;
  if (!Number.isFinite(result.comboDamageMultiplier)) result.comboDamageMultiplier = 1;
  if (!Number.isFinite(result.executeChance)) result.executeChance = 0;
  if (!Number.isFinite(result.executeThresholdPct)) result.executeThresholdPct = 0;

  for (const effect of effectRefs) {
    if (!isEffectConditionMet(effect, context)) continue;
    const mapped = STAT_EFFECT_MAP[effect?.key];
    if (!mapped) continue;

    const scale = Number(effect?.params?.value);
    if (mapped.mode === "add") {
      const amount = Number.isFinite(scale) ? scale : mapped.amount;
      result[mapped.stat] = (Number(result[mapped.stat]) || 0) + amount;
      continue;
    }

    if (mapped.mode === "mul") {
      // 統一百分比制：params.value 視為「+X%」→ 乘以 (1 + X/100)
      // 與 combatLoop 的 active-effect 路徑一致，避免「value=20 被當成 ×20」的爆炸
      // 無 params.value 時退回預設倍率（mapped.amount 本身就是倍率，如 1.2）
      let multiplier;
      if (Number.isFinite(scale)) {
        multiplier = 1 + scale / 100;
      } else {
        multiplier = mapped.amount;
      }
      result[mapped.stat] = (Number(result[mapped.stat]) || 0) * multiplier;
    }
  }

  return result;
}


function applyEffectInstances(currentEffects = [], incomingEffects = [], source = {}, context = {}) {
  const active = normalizeActiveEffectList(currentEffects);
  const next = [...active];

  for (const effectRef of incomingEffects) {
    if (!isEffectConditionMet(effectRef, context)) continue;
    const runtime = createRuntimeEffect(effectRef, source);
    if (!runtime) continue;
    const existingIndex = next.findIndex((entry) => {
      if (!entry || entry.key !== runtime.key) return false;
      const runtimeSourceId = runtime.sourceId ?? null;
      const entrySourceId = entry.sourceId ?? null;
      if (runtimeSourceId !== null && entrySourceId !== null) {
        return String(runtimeSourceId ?? "") === String(entrySourceId ?? "");
      }
      const runtimeSourceType = runtime.sourceType ?? null;
      const entrySourceType = entry.sourceType ?? null;
      if (runtimeSourceType !== null && entrySourceType !== null) {
        return String(runtimeSourceType ?? "") === String(entrySourceType ?? "");
      }
      return String(runtime.source || "") === String(entry.source || "");
    });
    if (existingIndex === -1) {
      next.push(runtime);
      continue;
    }

    const existing = next[existingIndex];
    const stackMode = effectRef.stackMode || "refresh";
    if (stackMode === "ignore") continue;
    if (stackMode === "replace" || stackMode === "refresh") {
      next[existingIndex] = {
        ...existing,
        ...runtime,
        remaining: cloneState(runtime.remaining)
      };
      continue;
    }
    if (stackMode === "stack") {
      next.push(runtime);
    }
  }

  return next;
}

function decrementActiveEffects(currentEffects = [], durationMode = "turns", amount = 1) {
  return normalizeActiveEffectList(currentEffects).flatMap((effect) => {
    if (effect.remaining?.mode !== durationMode) return [effect];
    const nextValue = Math.max(0, Number(effect.remaining.value) - amount);
    if (nextValue <= 0) return [];
    return [{ ...effect, remaining: { ...effect.remaining, value: nextValue } }];
  });
}

module.exports = {
  STAT_EFFECT_MAP,
  CONTROL_KEYS,
  DOT_KEYS,
  collectEffectRefsFromEntry,
  collectEquipmentEffects,
  mergeEquippedFromLibrary,
  createRuntimeEffect,
  applyEffectsToStats,
  isEffectConditionMet,
  applyEffectInstances,
  decrementActiveEffects,
};
