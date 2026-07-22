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
  // 職業徽章主動技能（踢到桌腳/死亡意志等）— DC 個人資料有列，網頁比照補上，
  // 讓玩家不用把徽章裝上去再開 DC 才看得到技能詳情。
  const jobSkills = Array.isArray(lib?.jobSkills) ? lib.jobSkills : [];
  if (jobSkills.length > 0) {
    const normal = jobSkills.filter((sk) => sk?.name && !sk.trigger);
    const custom = jobSkills.filter((sk) => sk?.name && sk.trigger);
    const fmt = (sk) => {
      const cd = Number(sk.cooldownTurns) > 0 ? `（CD ${sk.cooldownTurns} 回合）` : "";
      const wt = sk?.condition?.weaponType;
      const need = wt ? `〔需${Array.isArray(wt) ? wt.join("/") : wt}〕` : "";
      const stunOnly = sk?.condition?.targetStunned ? "〔敵方暈眩中〕" : "";
      const stance = sk?.condition?.stance ? `〔${sk.condition.stance === "defense" ? "防禦" : "攻擊"}姿態〕` : "";
      const desc = sk.description ? String(sk.description).trim() : "";
      return `・${sk.name}${need}${stance}${stunOnly}：${desc}${cd}`;
    };
    if (normal.length > 0) {
      lines.push(`⚔️ 主動技能（每回合約 35% 從可用技能中發動 1 個）：`);
      for (const sk of normal) lines.push(fmt(sk));
    }
    // 帶自訂 trigger 的技能不吃 35% 閘門，條件成立就必定發動 → 分開說明，避免玩家誤會
    if (custom.length > 0) {
      lines.push(`💥 特殊技能（條件成立必定發動，不佔上面的隨機名額）：`);
      for (const sk of custom) lines.push(fmt(sk));
    }
  }
  // 二轉專屬機制（姿態／連段／集氣／暈眩專精）——這些不在 passiveEffects 也不在 jobSkills，
  // 而是寫在 jobAdvancement 的分支設定裡，不特別撈出來玩家就完全看不到。
  for (const line of buildT2MechanicLines(lib)) lines.push(line);
  return lines;
}

/**
 * 二轉徽章的專屬機制說明。
 * 資料來源是 jobAdvancement 的分支設定（不是道具欄位），所以要另外組。
 * 非二轉徽章回空陣列。
 */
function buildT2MechanicLines(lib) {
  const id = String(lib?.itemId || lib?.id || "");
  if (!id) return [];
  let branch = null;
  try {
    branch = require("./jobAdvancement").getT2Branch(id);
  } catch (_) { return []; }
  if (!branch) return [];

  const out = [`🔱 二轉專屬（${branch.name}）：`];

  // 戰鬥姿態（聖劍士）
  if (branch.stances) {
    out.push(`・開打前選擇姿態，整場適用（戰鬥畫面兩顆按鈕）`);
    for (const [key, st] of Object.entries(branch.stances)) {
      const bits = [];
      if (Number.isFinite(Number(st.blockChance))) bits.push(`格擋率 ${st.blockChance}%`);
      if (st.guaranteedElement) bits.push(`保證取得屬性相剋優勢`);
      if (Number(st.shieldBashPct) > 0) bits.push(`格擋成功追加盾擊（ATK ${st.shieldBashPct}%）`);
      if (st.requiresShield) bits.push(`需裝備盾牌`);
      out.push(`　◦ ${st.label || key}：${bits.join("、")}`);
    }
  }

  // 區域連段（劍鬼）
  if (branch.combo) {
    try {
      const zc = require("./zoneCombo");
      out.push(`・區域連段（COMBO）：同一區每打完一場 +1，換區／陣亡／10 分鐘沒打歸零`);
      out.push(`　◦ 階梯加成（${zc.COMBO_BUFF_MAX_AT} 段吃滿）：${zc.COMBO_TIERS.map((t) => `${t.at}→${t.label}`).join("、")}`);
      out.push(`　◦ 斬：連段 ≥${zc.BURST_MIN_COMBO} 時戰鬥畫面出現按鈕，消耗全部連段，第 1 回合打出無視防禦與等級差的一擊（仍可爆擊）`);
      out.push(`　◦ 不屈：第一次陣亡連段減半，連續第二次才歸零`);
    } catch (_) { /* 模組讀不到就略過 */ }
  }

  // 血怒／血祭／戰意集氣（狂戰士）
  if (branch.bloodRage) {
    out.push(`・血怒（被動）：每缺 1% HP → 攻擊力 +${branch.bloodRage.perMissPct}%，最高 +${branch.bloodRage.capPct}%`);
  }
  if (branch.sacrifice) {
    out.push(`・血祭（戰鬥畫面按鈕）：開場自傷最大 HP 的 ${branch.sacrifice.hpCostPct}%，換整場攻擊力 +${branch.sacrifice.atkUpPct}%`);
  }
  if (branch.gauge) {
    out.push(`・戰意集氣（被動）：每打完一場 +1 格，集滿 ${branch.gauge.max} 格的下一戰爆擊率 +${branch.gauge.critRateBonus}，之後歸零重集`);
  }

  // 暈眩專精（矮人戰士長）
  if (branch.stunMastery) {
    out.push(`・山碎（被動）：對暈眩中的目標無視防禦（固定防禦仍在）`);
    out.push(`・巨神之握（被動）：世界王對你的暈眩上限 1 → ${branch.stunMastery.bossStunCap} 回合`);
  }
  if (branch.stunGauge) {
    try {
      const dsg = require("./dwarfStunGauge");
      out.push(`・巨神震擊（被動・團隊）：只有你敲得動世界王的暈眩條，敲擊量＝該場實際有攻擊到的回合數`);
      out.push(`　◦ 敲滿 ${dsg.DEFAULT_THRESHOLD} → 全服 ${Math.round(dsg.STUN_WINDOW_MS / 1000)} 秒內出戰的人整場免傷，之後王免疫 ${Math.round(dsg.IMMUNE_MS / 60000)} 分鐘`);
    } catch (_) { /* noop */ }
  }

  // 爬塔光環
  if (branch.towerAura?.notes) out.push(`・${branch.towerAura.notes}`);
  return out.length > 1 ? out : [];
}

module.exports = {
  buildT2MechanicLines,
  PCT_VALUE_EFFECT_KEYS,
  NO_VALUE_EFFECT_KEYS,
  formatEffectValueText,
  buildItemEffectLines,
};
