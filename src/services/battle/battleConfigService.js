const VALID_WEAPON_TYPES = [
  "sword_1h",
  "sword_2h",
  "dagger",
  "mace_1h",
  "mace_2h",
  "axe_1h",
  "axe_2h",
  "staff_1h",
  "staff_2h",
  "bow"
];

const ASSET_CATEGORIES = ["backgrounds", "monsters", "characters", "effects", "ui"];
const TEMPLATE_TYPES = ["character", "monster"];
const OFFHAND_MODES = ["any", "none", "specific"];
const CHARACTER_ACTION_KEYS = [
  "idle",
  "prepare_attack",
  "run",
  "attack_1",
  "attack_2",
  "attack_3",
  "critical_1",
  "critical_2",
  "walk"
];
const MONSTER_ACTION_KEYS = [
  "idle",
  "move",
  "attack_melee",
  "attack_range",
  "skill_cast",
  "skill_release",
  "summon",
  "roar",
  "hit",
  "stun",
  "enraged",
  "death"
];

const DEFAULT_WEAPON_RULES = {
  default: { preferredRange: 210, minRange: 150, maxRange: 320, laneBias: 0, xOffset: 0, yOffset: 0 },
  sword_1h: { preferredRange: 180, minRange: 120, maxRange: 230, laneBias: 0, xOffset: 0, yOffset: 0 },
  sword_2h: { preferredRange: 170, minRange: 115, maxRange: 220, laneBias: 0, xOffset: 4, yOffset: 0 },
  dagger: { preferredRange: 145, minRange: 95, maxRange: 200, laneBias: -1, xOffset: 10, yOffset: 0 },
  mace_1h: { preferredRange: 175, minRange: 115, maxRange: 230, laneBias: 0, xOffset: 2, yOffset: 0 },
  mace_2h: { preferredRange: 168, minRange: 110, maxRange: 225, laneBias: 0, xOffset: 4, yOffset: 0 },
  axe_1h: { preferredRange: 172, minRange: 112, maxRange: 230, laneBias: 0, xOffset: 4, yOffset: 0 },
  axe_2h: { preferredRange: 162, minRange: 102, maxRange: 220, laneBias: 0, xOffset: 8, yOffset: 0 },
  staff_1h: { preferredRange: 250, minRange: 190, maxRange: 340, laneBias: 1, xOffset: -6, yOffset: 0 },
  staff_2h: { preferredRange: 265, minRange: 205, maxRange: 360, laneBias: 1, xOffset: -8, yOffset: 0 },
  bow: { preferredRange: 300, minRange: 240, maxRange: 390, laneBias: 1, xOffset: -14, yOffset: 0 }
};

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function normalizeAssetEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const id = String(entry.id || "").trim();
  const name = String(entry.name || "").trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    actionKey: entry.actionKey ? String(entry.actionKey).trim() : null,
    roleType: entry.roleType ? String(entry.roleType).trim() : null,
    bindWeaponType: entry.bindWeaponType ? String(entry.bindWeaponType).trim() : null,
    bindOffhandMode: entry.bindOffhandMode ? String(entry.bindOffhandMode).trim() : "any",
    bindOffhandType: entry.bindOffhandType ? String(entry.bindOffhandType).trim() : null,
    bindMonsterId: entry.bindMonsterId ? String(entry.bindMonsterId).trim() : null,
    imageUrl: entry.imageUrl ? String(entry.imageUrl) : null,
    thumbnailUrl: entry.thumbnailUrl ? String(entry.thumbnailUrl) : null,
    fps: clampNumber(entry.fps, 1, 120, 12),
    frameCount: clampNumber(entry.frameCount, 1, 240, 1),
    loop: entry.loop !== false,
    tags: Array.isArray(entry.tags) ? entry.tags.map((t) => String(t).trim()).filter(Boolean) : [],
    note: entry.note ? String(entry.note) : "",
    updatedAt: new Date().toISOString()
  };
}

function normalizeWeaponRule(rule, fallback) {
  const base = fallback || DEFAULT_WEAPON_RULES.default;
  const preferred = clampNumber(rule?.preferredRange, 80, 520, base.preferredRange);
  const minRange = clampNumber(rule?.minRange, 40, preferred, Math.min(base.minRange, preferred));
  const maxRange = clampNumber(rule?.maxRange, preferred, 620, Math.max(base.maxRange, preferred));

  return {
    preferredRange: preferred,
    minRange,
    maxRange,
    laneBias: clampNumber(rule?.laneBias, -2, 2, base.laneBias),
    xOffset: clampNumber(rule?.xOffset, -80, 80, base.xOffset),
    yOffset: clampNumber(rule?.yOffset, -80, 80, base.yOffset)
  };
}

function normalizeActionSlot(slot, fallback = {}) {
  return {
    imageUrl: slot?.imageUrl ? String(slot.imageUrl) : (fallback.imageUrl || null),
    frameCount: clampNumber(slot?.frameCount, 1, 240, Number.isFinite(fallback.frameCount) ? fallback.frameCount : 1),
    fps: clampNumber(slot?.fps, 1, 120, Number.isFinite(fallback.fps) ? fallback.fps : 10),
    loop: typeof slot?.loop === "boolean" ? slot.loop : (typeof fallback.loop === "boolean" ? fallback.loop : true)
  };
}

function buildDefaultActions(templateType = "character") {
  const keys = templateType === "monster" ? MONSTER_ACTION_KEYS : CHARACTER_ACTION_KEYS;
  const defaults = {};
  for (const key of keys) defaults[key] = { imageUrl: null, frameCount: 1, fps: 10, loop: !key.includes("attack") && !key.includes("critical") && key !== "prepare_attack" && key !== "death" && key !== "hit" && key !== "stun" && key !== "roar" && key !== "summon" && key !== "skill_cast" && key !== "skill_release" };
  return defaults;
}

function normalizeTemplate(template) {
  if (!template || typeof template !== "object") return null;
  const id = String(template.id || "").trim();
  const name = String(template.name || "").trim();
  if (!id || !name) return null;

  const templateType = TEMPLATE_TYPES.includes(template.templateType) ? template.templateType : "character";
  const baseActions = buildDefaultActions(templateType);
  const sourceActions = template.actions && typeof template.actions === "object" ? template.actions : {};
  const actions = {};
  for (const [key, fallback] of Object.entries(baseActions)) {
    actions[key] = normalizeActionSlot(sourceActions[key], fallback);
  }

  return {
    id,
    name,
    templateType,
    bindWeaponType: template.bindWeaponType ? String(template.bindWeaponType).trim() : null,
    bindOffhandMode: OFFHAND_MODES.includes(template.bindOffhandMode) ? template.bindOffhandMode : "any",
    bindOffhandType: template.bindOffhandType ? String(template.bindOffhandType).trim() : null,
    bindMonsterId: template.bindMonsterId ? String(template.bindMonsterId).trim() : null,
    note: template.note ? String(template.note) : "",
    actions,
    updatedAt: new Date().toISOString()
  };
}

class BattleConfigService {
  constructor(battleConfigRepository) {
    this.battleConfigRepository = battleConfigRepository;
  }

  buildDefaultConfig() {
    const assets = {};
    for (const category of ASSET_CATEGORIES) assets[category] = [];

    return {
      version: 1,
      assets,
      animationTemplates: [],
      weaponPositionRules: { ...DEFAULT_WEAPON_RULES },
      updatedAt: new Date().toISOString()
    };
  }

  async getConfig() {
    const raw = await this.battleConfigRepository.get();
    const defaults = this.buildDefaultConfig();
    if (!raw || typeof raw !== "object") return defaults;

    const assets = {};
    for (const category of ASSET_CATEGORIES) {
      const list = Array.isArray(raw.assets?.[category]) ? raw.assets[category] : [];
      assets[category] = list.map(normalizeAssetEntry).filter(Boolean);
    }

    const weaponPositionRules = {};
    const knownKeys = ["default", ...VALID_WEAPON_TYPES];
    for (const key of knownKeys) {
      weaponPositionRules[key] = normalizeWeaponRule(
        raw.weaponPositionRules?.[key],
        DEFAULT_WEAPON_RULES[key] || DEFAULT_WEAPON_RULES.default
      );
    }

    return {
      version: Number(raw.version) || 1,
      assets,
      animationTemplates: Array.isArray(raw.animationTemplates) ? raw.animationTemplates.map(normalizeTemplate).filter(Boolean) : [],
      weaponPositionRules,
      updatedAt: raw.updatedAt || new Date().toISOString()
    };
  }

  async saveWeaponRules(patch = {}) {
    const config = await this.getConfig();
    const nextRules = { ...config.weaponPositionRules };
    for (const [key, rule] of Object.entries(patch || {})) {
      if (key !== "default" && !VALID_WEAPON_TYPES.includes(key)) continue;
      nextRules[key] = normalizeWeaponRule(rule, nextRules[key] || DEFAULT_WEAPON_RULES[key] || DEFAULT_WEAPON_RULES.default);
    }
    const next = { ...config, weaponPositionRules: nextRules, updatedAt: new Date().toISOString() };
    await this.battleConfigRepository.save(next);
    return next;
  }

  async saveAssetCategory(category, entries = []) {
    if (!ASSET_CATEGORIES.includes(category)) {
      throw new Error(`Unsupported battle asset category: ${category}`);
    }
    const config = await this.getConfig();
    const normalized = Array.isArray(entries) ? entries.map(normalizeAssetEntry).filter(Boolean) : [];
    const next = {
      ...config,
      assets: { ...config.assets, [category]: normalized },
      updatedAt: new Date().toISOString()
    };
    await this.battleConfigRepository.save(next);
    return next;
  }

  async getViewerConfig() {
    const config = await this.getConfig();
    return {
      version: config.version,
      weaponPositionRules: config.weaponPositionRules,
      assets: {
        monsters: config.assets.monsters || [],
        characters: config.assets.characters || [],
        backgrounds: config.assets.backgrounds || [],
        effects: config.assets.effects || [],
        ui: config.assets.ui || []
      },
      updatedAt: config.updatedAt
    };
  }

  async getAnimationStudioData() {
    const config = await this.getConfig();
    return {
      templates: Array.isArray(config.animationTemplates) ? config.animationTemplates : [],
      updatedAt: config.updatedAt
    };
  }

  async saveAnimationTemplates(templates = []) {
    const config = await this.getConfig();
    const normalized = Array.isArray(templates) ? templates.map(normalizeTemplate).filter(Boolean) : [];
    const next = {
      ...config,
      animationTemplates: normalized,
      updatedAt: new Date().toISOString()
    };
    await this.battleConfigRepository.save(next);
    return next.animationTemplates;
  }
}

module.exports = {
  BattleConfigService,
  ASSET_CATEGORIES,
  VALID_WEAPON_TYPES,
  CHARACTER_ACTION_KEYS,
  MONSTER_ACTION_KEYS
};
