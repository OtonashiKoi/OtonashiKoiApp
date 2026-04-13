const {
  EFFECT_CATEGORIES,
  EFFECT_SOURCES,
  STACK_MODES,
  DURATION_MODES,
  TRIGGER_KEYS,
  EFFECT_DEFINITIONS,
  EFFECT_DEFINITION_MAP,
  EFFECT_DEFINITION_CONFIG
} = require("../../shared/effectDefinitions");

class EffectDefinitionService {
  constructor(effectDefinitionRepository) {
    this.effectDefinitionRepository = effectDefinitionRepository;
  }

  buildDefaultConfig() {
    return {
      version: EFFECT_DEFINITION_CONFIG.version,
      categories: [...EFFECT_CATEGORIES],
      sourceTypes: [...EFFECT_SOURCES],
      stackModes: [...STACK_MODES],
      durationModes: [...DURATION_MODES],
      triggerKeys: [...TRIGGER_KEYS],
      definitions: EFFECT_DEFINITIONS.map((definition) => ({ ...definition })),
      updatedAt: new Date().toISOString()
    };
  }

  async getConfig() {
    const stored = await this.effectDefinitionRepository.get();
    if (!stored || typeof stored !== "object") return this.buildDefaultConfig();

    const fallback = this.buildDefaultConfig();
    return {
      version: Number(stored.version) || fallback.version,
      categories: Array.isArray(stored.categories) && stored.categories.length ? stored.categories : fallback.categories,
      sourceTypes: Array.isArray(stored.sourceTypes) && stored.sourceTypes.length ? stored.sourceTypes : fallback.sourceTypes,
      stackModes: Array.isArray(stored.stackModes) && stored.stackModes.length ? stored.stackModes : fallback.stackModes,
      durationModes: Array.isArray(stored.durationModes) && stored.durationModes.length ? stored.durationModes : fallback.durationModes,
      triggerKeys: Array.isArray(stored.triggerKeys) && stored.triggerKeys.length ? stored.triggerKeys : fallback.triggerKeys,
      definitions: Array.isArray(stored.definitions) && stored.definitions.length ? stored.definitions : fallback.definitions,
      updatedAt: stored.updatedAt || fallback.updatedAt
    };
  }

  async syncDefaults() {
    const current = await this.getConfig();
    const incomingByKey = new Map(EFFECT_DEFINITIONS.map((definition) => [definition.key, { ...definition }]));
    const mergedDefinitions = [];

    for (const definition of current.definitions) {
      if (!definition?.key) continue;
      if (incomingByKey.has(definition.key)) {
        mergedDefinitions.push(incomingByKey.get(definition.key));
        incomingByKey.delete(definition.key);
        continue;
      }
      mergedDefinitions.push(definition);
    }

    for (const definition of incomingByKey.values()) {
      mergedDefinitions.push(definition);
    }

    const next = {
      version: Math.max(EFFECT_DEFINITION_CONFIG.version, Number(current.version) || 0),
      categories: [...EFFECT_CATEGORIES],
      sourceTypes: [...EFFECT_SOURCES],
      stackModes: [...STACK_MODES],
      durationModes: [...DURATION_MODES],
      triggerKeys: [...TRIGGER_KEYS],
      definitions: mergedDefinitions,
      updatedAt: new Date().toISOString()
    };

    await this.effectDefinitionRepository.save(next);
    return next;
  }

  async listDefinitions() {
    const config = await this.getConfig();
    return config.definitions;
  }

  async getDefinitionByKey(key) {
    const config = await this.getConfig();
    return config.definitions.find((definition) => definition.key === key) || null;
  }

  getBuiltInDefinitionByKey(key) {
    return EFFECT_DEFINITION_MAP[key] || null;
  }
}

module.exports = {
  EffectDefinitionService
};
