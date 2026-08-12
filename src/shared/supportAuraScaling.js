"use strict";

const { collectEquipmentEffects } = require("./effectEngine");
const { getElementCombatProfile, normalizeElement } = require("./elementSystem");

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

function snapshotSupportShotParams(effect, providerStats = {}, equipped = {}, inventory = [], zone = null) {
  const elements = {};
  for (const row of getElementCombatProfile(equipped).elements || []) {
    if (row.attackLevel > 0) elements[row.element] = row.attackLevel;
  }

  const bonusVsElement = {};
  const context = { equipped, inventory: Array.isArray(inventory) ? inventory : [], zone };
  for (const ref of collectEquipmentEffects(equipped, "passive", context)) {
    if (ref?.key !== "bonus_vs_element") continue;
    const element = normalizeElement(ref.params?.element);
    const value = Math.abs(Number(ref.params?.value) || 0);
    if (element && value > 0) bonusVsElement[element] = (bonusVsElement[element] || 0) + value;
  }

  return {
    ...(effect.params || {}),
    casterAtk: Math.max(0, Math.round(Number(providerStats.atk) || 0)),
    casterCrit: Math.max(0, Number(providerStats.crit) || 0),
    casterFinalDamageMult: Math.max(0.01,
      (Number(providerStats.finalDamageMultiplier) || 1)
      * (Number(providerStats.tierFinalDamageMultiplier) || 1)
    ),
    casterElements: elements,
    casterBonusVsElement: bonusVsElement,
  };
}

function getSupportJobKey({ jobKey = null, jobName = null, equipped = {} } = {}) {
  const rawKey = String(jobKey || equipped?.job_eq?.itemId || equipped?.job_eq?.id || "").toLowerCase();
  const rawName = String(jobName || equipped?.job_eq?.itemName || equipped?.job_eq?.name || "");

  // ⭐ 一律走 jobAdvancement.resolveJobKey（唯一入口）；二轉徽章會解析回一轉 key
  try {
    const k = require("./jobAdvancement").resolveJobKey({ itemId: rawKey, itemName: rawName });
    if (k) return k;
  } catch (_) { /* 模組讀不到 → 回 null，行為與找不到職業相同 */ }
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

  // 縮放公式統一以 base 為起點往上加，每 step 點屬性 +1%（或 +0.5%）
  // 上限為 base + cap，確保不會無限膨脹
  // 設計基準：Lv40 平均屬性 ~14，最大專注投資 ~35，step=10 → 平均 +1%，最大 +3~4%
  if (jobKey === "healer") {
    if (effectKey === "heal_over_time" || effectKey === "party_heal") {
      statKey = "int";
      scaled = clampAuraValue(base + floorStep(int, 10, 0.5), base + 4);
    } else if (effectKey === "party_damage_up") {
      statKey = "dex";
      scaled = clampAuraValue(base + floorStep(dex, 12, 1), base + 5);
    }
  } else if (jobKey === "tactician") {
    if (effectKey === "party_boss_damage_up" || effectKey === "party_damage_up") {
      statKey = "agi";
      scaled = clampAuraValue(base + floorStep(agi, 12, 1), base + 5);
    } else if (effectKey === "party_monster_def_down") {
      statKey = "int";
      scaled = clampAuraValue(base + floorStep(int, 12, 1), base + 5);
    }
  } else if (jobKey === "bard") {
    if (effectKey === "party_exp_gain_up" || effectKey === "party_gold_gain_up") {
      statKey = "luk";
      scaled = clampAuraValue(base + floorStep(luk, 12, 1), base + 5);
    } else if (effectKey === "party_agi_up") {
      statKey = "dex";
      scaled = clampAuraValue(base + floorStep(dex, 10, 1), base + 8);
    } else if (effectKey === "party_combo_up") {
      statKey = "agi";
      scaled = clampAuraValue(base + floorStep(agi, 12, 1), base + 5);
    }
  } else if (jobKey === "barrier_mage") {
    if (effectKey === "party_damage_reduction") {
      statKey = "vit";
      scaled = clampAuraValue(base + floorStep(vit, 10, 1), base + 8);
    } else if (effectKey === "party_crit_damage_reduction") {
      statKey = "int";
      scaled = clampAuraValue(base + floorStep(int, 10, 1), base + 8);
    } else if (effectKey === "party_max_hp_up") {
      statKey = "int";
      scaled = clampAuraValue(base + floorStep(int, 12, 1), base + 5);
    }
  } else if (jobKey === "swordsman") {
    if (effectKey === "party_damage_reduction") {
      statKey = "vit";
      scaled = clampAuraValue(base + floorStep(vit, 12, 1), base + 6);
    }
  } else if (jobKey === "warrior") {
    if (effectKey === "party_high_hp_damage_up") {
      statKey = "str";
      scaled = clampAuraValue(base + floorStep(str, 10, 1), base + 6);
    }
  } else if (jobKey === "dwarf_warrior") {
    if (effectKey === "party_stun_chance_up") {
      statKey = "vit";
      scaled = clampAuraValue(base + floorStep(vit, 12, 1), base + 5);
    } else if (effectKey === "party_stunned_damage_up") {
      statKey = "str";
      scaled = clampAuraValue(base + floorStep(str, 10, 1), base + 8);
    }
  } else if (jobKey === "rogue") {
    if (effectKey === "party_combo_up") {
      statKey = "agi";
      scaled = clampAuraValue(base + floorStep(agi, 12, 1), base + 5);
    }
  } else if (jobKey === "mage") {
    if (effectKey === "party_def_ignore_up") {
      statKey = "int";
      scaled = clampAuraValue(base + floorStep(int, 10, 1), base + 6);
    }
  } else if (jobKey === "archer") {
    if (effectKey === "party_boss_damage_up") {
      statKey = "dex";
      scaled = clampAuraValue(base + floorStep(dex, 10, 1), base + 6);
    } else if (effectKey === "party_elite_damage_up") {
      statKey = "luk";
      scaled = clampAuraValue(base + floorStep(luk, 12, 1), base + 5);
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
  equipped = {},
  inventory = [],
  zone = null,
} = {}) {
  if (!effect || effect.target !== "party" || !effect.key) return effect;
  const resolvedJobKey = getSupportJobKey({ jobKey, jobName, equipped });
  if (!resolvedJobKey) return effect;

  if (effect.key === "support_shot") {
    return { ...effect, params: snapshotSupportShotParams(effect, providerStats, equipped, inventory, zone) };
  }

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

// ── 光環在場判定 ──
// activeHealerAuras 的登記項帶 lastAt（提供者每次出戰刷新）；超過 3 分鐘沒出戰＝已離場，
// 讀取/寫入時一律先過濾，讓「人走了光環還留在戰報」不再發生。
// 窗口與戰鬥氣泡(services/realtime/battlePresence)一致；無 lastAt 的舊格式登記一律視為過期。
const AURA_PRESENCE_WINDOW_MS = 3 * 60 * 1000;

function filterActiveAuras(auras, now = Date.now()) {
  if (!Array.isArray(auras)) return [];
  return auras.filter((a) =>
    a && a.discordId && Number(a.lastAt) > 0 && now - Number(a.lastAt) <= AURA_PRESENCE_WINDOW_MS
  );
}

module.exports = {
  calcScaledAuraValue,
  getSupportJobKey,
  snapshotSupportShotParams,
  scaleSupportPartyEffect,
  scaleSupportPartyEffects,
  AURA_PRESENCE_WINDOW_MS,
  filterActiveAuras
};
