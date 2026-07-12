const {
  EFFECT_DEFINITION_MAP,
  STACK_MODES,
  TRIGGER_KEYS,
  DURATION_MODES
} = require("./effectDefinitions");

const EFFECT_TARGETS = ["self", "enemy", "ally", "all_enemies", "all_allies"];
const EFFECT_PHASES = ["passive", "active", "proc", "consume", "skill", "monster_skill"];

function cloneJsonSafe(value, fallback) {
  if (value === undefined) return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function normalizeDuration(rawDuration, fallbackMode = "turns", fallbackValue = 1) {
  if (!rawDuration || typeof rawDuration !== "object") {
    return { mode: fallbackMode, value: fallbackValue };
  }
  const mode = DURATION_MODES.includes(rawDuration.mode) ? rawDuration.mode : fallbackMode;
  const value = Math.max(0, Number(rawDuration.value) || fallbackValue);
  return { mode, value };
}

function normalizeTrigger(trigger, fallback = "passive") {
  return TRIGGER_KEYS.includes(trigger) ? trigger : fallback;
}

function normalizeEffectRef(rawEffect = {}, options = {}) {
  const fallbackTrigger = options.fallbackTrigger || "passive";
  const fallbackTarget = options.fallbackTarget || "self";
  const key = String(rawEffect.key || "").trim();
  if (!key) return null;

  const definition = EFFECT_DEFINITION_MAP[key] || null;
  const target = EFFECT_TARGETS.includes(rawEffect.target) ? rawEffect.target : fallbackTarget;
  const trigger = normalizeTrigger(rawEffect.trigger, fallbackTrigger);
  const chance = Math.min(100, Math.max(0, Number(rawEffect.chance) || 100));
  const stacks = Math.max(1, Number(rawEffect.stacks) || 1);

  return {
    key,
    category: definition?.category || null,
    stackMode: STACK_MODES.includes(rawEffect.stackMode) ? rawEffect.stackMode : (definition?.stackMode || "refresh"),
    trigger,
    target,
    chance,
    stacks,
    duration: normalizeDuration(rawEffect.duration, "turns", 1),
    sourcePhase: EFFECT_PHASES.includes(rawEffect.sourcePhase) ? rawEffect.sourcePhase : (options.sourcePhase || "passive"),
    params: cloneJsonSafe(rawEffect.params, {}),
    condition: cloneJsonSafe(rawEffect.condition, null),
    notes: rawEffect.notes ? String(rawEffect.notes) : "",
    definitionName: definition?.name || null
  };
}

function normalizeEffectList(rawList, options = {}) {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .map((entry) => normalizeEffectRef(entry, options))
    .filter(Boolean);
}

function normalizeMonsterSkill(rawSkill = {}, idx = 0) {
  const id = String(rawSkill.id || `monster_skill_${idx + 1}`).trim() || `monster_skill_${idx + 1}`;
  const name = String(rawSkill.name || `Monster Skill ${idx + 1}`).trim() || `Monster Skill ${idx + 1}`;

  return {
    id,
    name,
    trigger: normalizeTrigger(rawSkill.trigger, "on_attack"),
    chance: Math.min(100, Math.max(0, Number(rawSkill.chance) || 100)),
    cooldownTurns: Math.max(0, Number(rawSkill.cooldownTurns) || 0),
    priority: Math.max(0, Number(rawSkill.priority) || 0),
    target: EFFECT_TARGETS.includes(rawSkill.target) ? rawSkill.target : "enemy",
    effects: normalizeEffectList(rawSkill.effects, { fallbackTrigger: "on_attack", fallbackTarget: "enemy", sourcePhase: "monster_skill" }),
    notes: rawSkill.notes ? String(rawSkill.notes) : ""
  };
}

function normalizeMonsterSkillList(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList.map((skill, idx) => normalizeMonsterSkill(skill, idx)).filter(Boolean);
}

function normalizeActiveEffect(rawEffect = {}) {
  const normalized = normalizeEffectRef(rawEffect, {
    fallbackTrigger: "passive",
    fallbackTarget: "self",
    sourcePhase: "active"
  });
  if (!normalized) return null;

  const remaining = normalizeDuration(rawEffect.remaining || rawEffect.duration, normalized.duration.mode, normalized.duration.value);
  // seconds 時效 buff：建立時蓋 expiresAt(一次，之後保留)，讓「限時」buff 能按真實時間到期消失。
  let expiresAt = rawEffect.expiresAt ? Number(rawEffect.expiresAt) : null;
  if (!expiresAt && remaining.mode === "seconds" && remaining.value > 0) {
    expiresAt = Date.now() + remaining.value * 1000;
  }

  return {
    ...normalized,
    id: String(rawEffect.id || `${normalized.key}_${Date.now()}`).trim(),
    sourceType: rawEffect.sourceType ? String(rawEffect.sourceType) : "system",
    sourceId: rawEffect.sourceId ? String(rawEffect.sourceId) : null,
    remaining,
    ...(expiresAt ? { expiresAt } : {}),
    createdAt: rawEffect.createdAt || new Date().toISOString()
  };
}

/** 限時 buff 是否已過期（有 expiresAt 且已過真實時間）。 */
function isActiveEffectExpired(effect) {
  return Boolean(effect && effect.expiresAt && Date.now() >= Number(effect.expiresAt));
}

function normalizeActiveEffectList(rawList) {
  if (!Array.isArray(rawList)) return [];
  // 順便濾掉「已過期的限時 buff」→ 每次讀取/存回都會自動清掉過期項（如攻塔祝福到時消失）
  return rawList.map((entry) => normalizeActiveEffect(entry)).filter(Boolean).filter((e) => !isActiveEffectExpired(e));
}

module.exports = {
  EFFECT_TARGETS,
  EFFECT_PHASES,
  normalizeDuration,
  normalizeEffectRef,
  normalizeEffectList,
  normalizeMonsterSkill,
  normalizeMonsterSkillList,
  normalizeActiveEffect,
  normalizeActiveEffectList,
  isActiveEffectExpired
};
