// 道具「特效簡易說明」列產生器（背包詳細視窗、戰鬥掉落氣泡共用）。
// 卡片 → monsterCardSkill 技能名＋描述（同 DC 已裝備卡片區格式）；
// 裝備 → passive/combat/proc 效果的中文名＋數值（優先用 notes 文案）。
const { EFFECT_NAME_ZH } = require("./effectDisplayNames");

// 身上特效數值單位表 — 依 src/shared/combatLoop.js / effectEngine.js 引擎實際語意，
// 只列「語意上明確是百分比」的 key（各種率、倍率、吸血、DOT、減傷）。
// 有歧義的固定屬性（atk_up/def_up/str_up… 被動裝備是固定值）一律不加 %。
const PCT_VALUE_EFFECT_KEYS = new Set([
  // 倍率類（引擎 mode "mul"，value 視為 +X%）
  "atk_multiplier_up", "def_multiplier_up", "max_hp_multiplier_up",
  "final_damage_up", "final_damage_down", "damage_taken_up",
  "crit_damage_up", "crit_damage_down",
  // 率類（0~100 百分點）
  "crit_rate_up", "crit_rate_down", "combo_up", "combo_damage_up",
  "dodge_up", "dodge_down", "hit_up", "hit_down",
  "block_chance_up", "execute_chance_up", "stun_chance_up",
  // 比例類（佔傷害/血量百分比）
  "lifesteal", "life_steal_strong", "counter",
  "damage_reduction", "physical_damage_reduction", "magic_damage_reduction",
  "def_ignore", "heal_over_time", "enemy_heal_reduction",
  "bonus_vs_poisoned", "bonus_vs_debuffed", "bonus_vs_boss",
  "bonus_vs_def_broken", "bonus_vs_burning"
]);
// 這些 key 引擎不使用 value（純開關/觸發），不顯示數字
const NO_VALUE_EFFECT_KEYS = new Set(["invincible_short", "cleanse_self"]);

// 顯示用數值格式化：依引擎語意決定 %；params.mode 明確指定時優先採用
function formatEffectValueText(key, params = {}) {
  if (NO_VALUE_EFFECT_KEYS.has(key)) return "";
  const v = Number(params?.value);
  if (!Number.isFinite(v)) return "";
  if (params?.mode === "flat") return `${v > 0 ? "+" : ""}${v}`;
  const isPct = params?.mode === "pct" || params?.mode === "mul" || PCT_VALUE_EFFECT_KEYS.has(key);
  return `${v > 0 ? "+" : ""}${v}${isPct ? "%" : ""}`;
}

function buildItemEffectLines(lib) {
  const lines = [];
  const skill = lib?.monsterCardSkill;
  if (skill?.name) {
    lines.push(`🎴 ${skill.name}${skill.description ? `（${skill.description}）` : ""}`);
  }
  const TRIGGER_ZH = { passive: "被動", combat: "戰鬥", proc: "觸發" };
  const groups = [
    ["passive", lib?.passiveEffects],
    ["combat", lib?.combatEffects],
    ["proc", lib?.procEffects],
  ];
  for (const [trigger, arr] of groups) {
    for (const eff of arr || []) {
      if (!eff?.key) continue;
      const name = EFFECT_NAME_ZH[eff.key] || eff.definitionName || eff.key;
      const valueText = formatEffectValueText(eff.key, eff?.params);
      const chance = Number(eff.chance ?? 100);
      const chanceText = chance < 100 ? `（${chance}%機率）` : "";
      const body = eff.notes || `${name}${valueText ? ` ${valueText}` : ""}`;
      lines.push(`✦ ${TRIGGER_ZH[trigger] || trigger}：${body}${chanceText}`);
    }
  }
  return lines;
}

module.exports = {
  PCT_VALUE_EFFECT_KEYS,
  NO_VALUE_EFFECT_KEYS,
  formatEffectValueText,
  buildItemEffectLines,
};
