"use strict";

function getStat(stats = {}, key) {
  return Math.max(0, Number(stats?.[key] || 0));
}

function floorStep(stat, step, gain) {
  return Math.floor(Math.max(0, stat) / step) * gain;
}

function clampAuraValue(value, max) {
  const clamped = Math.min(max, Math.max(0, Number(value) || 0));
  return Math.round(clamped * 10) / 10;
}

function getSupportJobKey({ jobKey = null, jobName = null, equipped = {} } = {}) {
  const rawKey = String(jobKey || equipped?.job_eq?.itemId || equipped?.job_eq?.id || "").toLowerCase();
  const rawName = String(jobName || equipped?.job_eq?.itemName || equipped?.job_eq?.name || "");

  if (rawKey.includes("healer") || rawName.includes("治療")) return "healer";
  if (rawKey.includes("tactician") || rawName.includes("軍師")) return "tactician";
  if (rawKey.includes("bard") || rawName.includes("詩人")) return "bard";
  if (rawKey.includes("barrier_mage") || rawName.includes("結界師")) return "barrier_mage";
  if (rawKey.includes("swordsman") || rawName.includes("劍士")) return "swordsman";
  if (rawKey.includes("dwarf") || rawName.includes("矮人")) return "dwarf_warrior";
  if (rawKey.includes("warrior") || rawName.includes("戰士")) return "warrior";
  if (rawKey.includes("archer") || rawName.includes("弓箭手")) return "archer";
  if (rawKey.includes("rogue") || rawName.includes("盜賊")) return "rogue";
  if (rawKey.includes("mage") || rawName.includes("法師")) return "mage";
  return null;
}

function calcScaledAuraValue(jobKey, effectKey, providerStats = {}, baseValue = 0) {
  const base = Math.max(0, Number(baseValue) || 0);
  const int = getStat(providerStats, "int");
  const agi = getStat(providerStats, "agi");
  const dex = getStat(providerStats, "dex");
  const vit = getStat(providerStats, "vit");
  const luk = getStat(providerStats, "luk");
  const str = getStat(providerStats, "str");

  let scaled = base;
  let statKey = null;

  if (jobKey === "healer") {
    if (effectKey === "heal_over_time" || effectKey === "party_heal") {
      statKey = "int";
      scaled = clampAuraValue(2 + floorStep(int, 50, 0.5), 6);
    } else if (effectKey === "party_damage_up") {
      statKey = "dex";
      scaled = clampAuraValue(3 + floorStep(dex, 80, 1), 10);
    }
  } else if (jobKey === "tactician") {
    if (effectKey === "party_boss_damage_up" || effectKey === "party_damage_up") {
      statKey = "agi";
      scaled = clampAuraValue(4 + floorStep(agi, 60, 1), 12);
    } else if (effectKey === "party_monster_def_down") {
      statKey = "int";
      scaled = clampAuraValue(4 + floorStep(int, 70, 1), 12);
    }
  } else if (jobKey === "bard") {
    if (effectKey === "party_exp_gain_up" || effectKey === "party_gold_gain_up") {
      statKey = "luk";
      scaled = clampAuraValue(5 + floorStep(luk, 80, 1), 12);
    } else if (effectKey === "party_agi_up") {
      statKey = "dex";
      scaled = clampAuraValue(5 + floorStep(dex, 50, 1), 15);
    } else if (effectKey === "party_combo_up") {
      statKey = "agi";
      scaled = clampAuraValue(3 + floorStep(agi, 70, 1), 10);
    }
  } else if (jobKey === "barrier_mage") {
    if (effectKey === "party_damage_reduction") {
      statKey = "vit";
      scaled = clampAuraValue(8 + floorStep(vit, 60, 1), 18);
    } else if (effectKey === "party_crit_damage_reduction") {
      statKey = "int";
      scaled = clampAuraValue(8 + floorStep(int, 60, 1), 20);
    } else if (effectKey === "party_max_hp_up") {
      statKey = "int";
      scaled = clampAuraValue(5 + floorStep(int, 70, 1), 12);
    }
  } else if (jobKey === "swordsman") {
    if (effectKey === "party_damage_reduction") {
      statKey = "vit";
      scaled = clampAuraValue(3 + floorStep(vit, 70, 1), 12);
    }
  } else if (jobKey === "warrior") {
    if (effectKey === "party_high_hp_damage_up") {
      statKey = "str";
      scaled = clampAuraValue(4 + floorStep(str, 60, 1), 14);
    }
  } else if (jobKey === "dwarf_warrior") {
    if (effectKey === "party_stun_chance_up") {
      statKey = "vit";
      scaled = clampAuraValue(5 + floorStep(vit, 70, 1), 14);
    } else if (effectKey === "party_stunned_damage_up") {
      statKey = "str";
      scaled = clampAuraValue(8 + floorStep(str, 60, 1), 20);
    }
  } else if (jobKey === "rogue") {
    if (effectKey === "party_combo_up") {
      statKey = "agi";
      scaled = clampAuraValue(3 + floorStep(agi, 70, 1), 10);
    }
  } else if (jobKey === "mage") {
    if (effectKey === "party_def_ignore_up") {
      statKey = "int";
      scaled = clampAuraValue(4 + floorStep(int, 60, 1), 14);
    }
  } else if (jobKey === "archer") {
    if (effectKey === "party_boss_damage_up") {
      statKey = "dex";
      scaled = clampAuraValue(4 + floorStep(dex, 60, 1), 14);
    } else if (effectKey === "party_elite_damage_up") {
      statKey = "luk";
      scaled = clampAuraValue(4 + floorStep(luk, 70, 1), 12);
    }
  }

  return {
    value: Math.max(base, scaled),
    scaledValue: scaled,
    baseValue: base,
    statKey
  };
}

function scaleSupportPartyEffect(effect, {
  providerStats = {},
  jobKey = null,
  jobName = null,
  equipped = {}
} = {}) {
  if (!effect || effect.target !== "party" || !effect.key) return effect;
  const resolvedJobKey = getSupportJobKey({ jobKey, jobName, equipped });
  if (!resolvedJobKey) return effect;

  const currentValue = Number(effect?.params?.value ?? effect.value ?? 0);
  const scaled = calcScaledAuraValue(resolvedJobKey, effect.key, providerStats, currentValue);
  if (scaled.value <= currentValue) return effect;

  return {
    ...effect,
    params: {
      ...(effect.params || {}),
      value: scaled.value,
      supportAuraBaseValue: scaled.baseValue,
      supportAuraStat: scaled.statKey,
      supportAuraJob: resolvedJobKey
    },
    notes: `${effect.notes || ""}${effect.notes ? "；" : ""}${scaled.statKey || "屬性"} 光環補正：${scaled.value}%`
  };
}

function scaleSupportPartyEffects(effects = [], options = {}) {
  return (Array.isArray(effects) ? effects : []).map((effect) => scaleSupportPartyEffect(effect, options));
}

module.exports = {
  calcScaledAuraValue,
  getSupportJobKey,
  scaleSupportPartyEffect,
  scaleSupportPartyEffects
};
