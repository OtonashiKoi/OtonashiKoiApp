const { randomUUID } = require("crypto");
const { normalizeActiveEffect, normalizeActiveEffectList } = require("./effectPayloads");

const STAT_EFFECT_MAP = {
  max_hp_up: { stat: "maxHp", mode: "add", amount: 50 },
  max_hp_down: { stat: "maxHp", mode: "add", amount: -50 },
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

  if (!matchNotConditionValues(condition.notHasItemId, hasItemId)) return false;
  if (!matchNotConditionValues(condition.notEquippedItemId, hasEquippedItemId)) return false;
  if (!matchNotConditionValues(condition.notEquippedSlot, hasEquippedSlot)) return false;
  if (!matchNotConditionValues(condition.notWeaponType, hasWeaponType)) return false;

  return true;
}

function collectEffectRefsFromEntry(entry, trigger = null, context = {}) {
  if (!entry || typeof entry !== "object") return [];
  const buckets = [
    ...(Array.isArray(entry.passiveEffects) ? entry.passiveEffects : []),
    ...(Array.isArray(entry.procEffects) ? entry.procEffects : []),
    ...(Array.isArray(entry.useEffects) ? entry.useEffects : []),
    ...(Array.isArray(entry.combatEffects) ? entry.combatEffects : [])
  ];
  return buckets.filter((effect) => {
    if (!effect || typeof effect !== "object") return false;
    if (trigger && effect.trigger !== trigger) return false;
    return isEffectConditionMet(effect, context);
  });
}

function collectEquipmentEffects(equipped, trigger = null, context = {}) {
  return Object.values(equipped || {}).flatMap((entry) => collectEffectRefsFromEntry(entry, trigger, context));
}

function createRuntimeEffect(effectRef, source = {}) {
  return normalizeActiveEffect({
    ...effectRef,
    id: source.id || randomUUID(),
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
      const amount = Number.isFinite(scale) ? scale : mapped.amount;
      result[mapped.stat] = (Number(result[mapped.stat]) || 0) * amount;
    }
  }

  return result;
}

function summarizeEffectState(activeEffects = []) {
  const normalized = normalizeActiveEffectList(activeEffects);
  return normalized.reduce((summary, effect) => {
    if (CONTROL_KEYS.has(effect.key)) summary.control.add(effect.key);
    if (DOT_KEYS.has(effect.key)) summary.dot.add(effect.key);
    if (effect.key === "shield") {
      summary.shield += Math.max(0, Number(effect.params?.value) || 0);
    }
    return summary;
  }, {
    control: new Set(),
    dot: new Set(),
    shield: 0
  });
}

function applyEffectInstances(currentEffects = [], incomingEffects = [], source = {}, context = {}) {
  const active = normalizeActiveEffectList(currentEffects);
  const next = [...active];

  for (const effectRef of incomingEffects) {
    if (!isEffectConditionMet(effectRef, context)) continue;
    const runtime = createRuntimeEffect(effectRef, source);
    if (!runtime) continue;
    const existingIndex = next.findIndex((entry) => entry.key === runtime.key);
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

function selectTriggeredEffects(effectRefs = [], trigger, roll = Math.random, context = {}) {
  return effectRefs.filter((effect) => {
    if (!effect || effect.trigger !== trigger) return false;
    if (!isEffectConditionMet(effect, context)) return false;
    const chance = Math.min(100, Math.max(0, Number(effect.chance) || 100));
    return roll() * 100 < chance;
  });
}

module.exports = {
  STAT_EFFECT_MAP,
  CONTROL_KEYS,
  DOT_KEYS,
  collectEffectRefsFromEntry,
  collectEquipmentEffects,
  createRuntimeEffect,
  applyEffectsToStats,
  isEffectConditionMet,
  summarizeEffectState,
  applyEffectInstances,
  decrementActiveEffects,
  selectTriggeredEffects
};
