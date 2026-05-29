require("dotenv").config();

const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { ZONE_DEFS, ZONE_BY_KEY } = require("../src/shared/zones");

const SHEET_URL = process.env.SHEET_WEBAPP_URL
  || "https://script.google.com/macros/s/AKfycbyugZgfyhRgNWDUpvVLnvpU9WAMzm3InMnDPpMPgW91ss53cEhqJnPlef4N3iuQ5s4-/exec";
const SECRET = process.env.SHEET_WEBAPP_SECRET || "eqgame_8K3mQ7vR2nL9pX4hF6sD1wY5tB";

// ── 文字工具 ────────────────────────────────────────────────────────────────
function statStr(stats) {
  if (!stats || typeof stats !== "object") return "";
  return ["str", "agi", "vit", "int", "dex", "luk"]
    .map((k) => [k.toUpperCase(), Number(stats[k]) || 0])
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => `${k}+${v}`)
    .join(" ");
}

const STAT_KEYS = ["str", "agi", "vit", "int", "dex", "luk"];
function statCells(stats) {
  return STAT_KEYS.map((k) => {
    const v = Number(stats?.[k]) || 0;
    return v === 0 ? "" : v;
  });
}

// ── 戰鬥效果中文對照 ─────────────────────────────────────────────────────────
const EFFECT_NAME_ZH = {
  max_hp_up: "最大HP提升", max_hp_down: "最大HP降低",
  atk_up: "攻擊提升", atk_down: "攻擊降低",
  def_up: "防禦提升", def_down: "防禦降低",
  mdef_up: "魔防提升", mdef_down: "魔防降低",
  hit_up: "命中提升", hit_down: "命中降低",
  dodge_up: "閃避提升", dodge_down: "閃避降低",
  crit_rate_up: "爆擊率提升", crit_rate_down: "爆擊率降低",
  crit_damage_up: "爆擊傷害提升", crit_damage_down: "爆擊傷害降低",
  speed_up: "速度提升", speed_down: "速度降低",
  final_damage_up: "最終傷害提升", final_damage_down: "最終傷害降低",
  heal_over_time: "持續治療", poison: "中毒", burn: "灼燒", bleed: "流血",
  shock_dot: "電擊", curse_dot: "詛咒", life_regen: "生命回復", mana_regen: "魔力回復",
  stun: "擊暈", freeze: "冰凍", sleep: "沉睡", silence: "沉默", root: "禁錮",
  slow: "緩速", blind: "致盲", taunt: "嘲諷", fear: "恐懼", confuse: "混亂", disarm: "繳械",
  shield: "護盾", barrier: "結界",
  damage_reduction: "傷害減免", physical_damage_reduction: "物理傷害減免", magic_damage_reduction: "魔法傷害減免",
  invincible_short: "短暫無敵", death_prevent_once: "免死一次", last_stand: "背水一戰",
  cleanse: "淨化", debuff_immunity: "Debuff 免疫", control_immunity: "控場免疫",
  lifesteal: "吸血", manasteal: "吸魔", thorns: "荊棘反傷", counter_attack: "反擊",
  reflect_magic: "魔法反射", damage_to_heal: "傷害轉治療",
  on_hit_heal: "命中回復", on_crit_heal: "爆擊回復",
  bonus_vs_boss: "對 BOSS 加成", bonus_vs_poisoned: "對中毒目標加成", bonus_vs_burning: "對燃燒目標加成",
  bonus_vs_stunned: "對擊暈目標加成", bonus_vs_debuffed: "對 Debuff 目標加成",
  bonus_when_hp_high: "高血量加成", bonus_when_hp_low: "低血量加成",
  bonus_first_hit: "首擊加成", bonus_counter_damage: "反擊傷害加成", execute_under_hp_pct: "斬殺",
  gold_gain_up: "金幣獲取提升", exp_gain_up: "經驗獲取提升",
  drop_rate_up: "掉落率提升", rare_drop_rate_up: "稀有掉落率提升",
  checkin_bonus_up: "簽到獎勵提升", enhance_success_up: "強化成功率提升",
  event_trigger_rate_up: "事件觸發率提升", monster_reward_up: "怪物獎勵提升",
  proc_stun: "觸發擊暈", proc_poison: "觸發中毒", proc_burn: "觸發灼燒", proc_bleed: "觸發流血",
  proc_slow: "觸發緩速", proc_def_down: "觸發防禦降低", proc_atk_down: "觸發攻擊降低",
  proc_extra_hit: "觸發追擊", proc_chain_hit: "觸發連擊", proc_execute: "觸發斬殺",
  proc_heal: "觸發治療", proc_shield: "觸發護盾", proc_cleanse: "觸發淨化",
  proc_dispel: "觸發驅散", proc_gain_buff: "觸發獲得 Buff",
  atk_multiplier_up: "攻擊倍率提升", block_chance_up: "格擋率提升", combo_damage_up: "連擊傷害提升",
  execute_chance_up: "斬殺觸發率提升", execute_threshold_up: "斬殺血量門檻提升",
  combo_up: "連擊機率提升", stun_chance_up: "擊暈機率提升",
  counter_on_dodge: "閃避反擊", proc_weak_spot: "觸發要害打擊",
  party_damage_up: "隊伍傷害提升", str_up: "STR 提升", weakness_hit_rate: "要害命中率",
  reflect_damage: "反傷", agi_up: "AGI 提升", agi_down: "AGI 降低", def_ignore: "無視防禦",
  lightning: "雷擊", charm: "魅惑", dark_curse: "暗影詛咒",
  party_boss_damage_up: "隊伍對 BOSS 傷害提升", party_monster_def_down: "隊伍對怪物防禦降低",
  party_damage_reduction: "隊伍傷害減免", party_crit_damage_reduction: "隊伍爆擊傷害減免",
  party_exp_gain_up: "隊伍經驗獲取提升", party_gold_gain_up: "隊伍金幣獲取提升",
  party_agi_up: "隊伍 AGI 提升",
};

const EFFECT_CATEGORY_ZH = {
  stat: "屬性類", dot: "持續傷害/治療", control: "控場類", defense: "防禦類",
  reactive: "反應類", conditional: "條件類", economy: "經濟類", proc: "觸發類",
};

const STACK_MODE_ZH = {
  replace: "取代", add: "累加", stack: "疊加",
};

const DURATION_MODE_ZH = {
  battle: "整場戰鬥", permanent: "永久", turns: "回合內", instant: "立即",
};

const SOURCE_TYPE_ZH = {
  equipment: "裝備", skill: "技能", npc_event: "NPC 事件",
  monster_card: "怪物卡", consumable: "消耗品", job_badge: "職業徽章",
  monster: "怪物", item: "道具", enhancement: "強化", buff: "Buff", debuff: "Debuff",
  passive: "被動", active: "主動",
};

function translateNote(en) {
  if (!en) return "";
  const m = {
    "Increase max HP.": "提升最大 HP。",
    "Reduce max HP ceiling.": "降低最大 HP 上限。",
    "Increase physical attack.": "提升物理攻擊。",
    "Reduce physical attack.": "降低物理攻擊。",
    "Increase defense.": "提升防禦。",
    "Reduce defense.": "降低防禦。",
    "Increase magic defense.": "提升魔法防禦。",
    "Reduce magic defense.": "降低魔法防禦。",
    "Increase hit rate.": "提升命中率。",
    "Reduce hit rate.": "降低命中率。",
    "Increase dodge.": "提升閃避。",
    "Reduce dodge.": "降低閃避。",
    "Increase crit rate.": "提升爆擊率。",
    "Reduce crit rate.": "降低爆擊率。",
    "Increase critical damage.": "提升爆擊傷害。",
    "Reduce critical damage.": "降低爆擊傷害。",
    "Increase action speed or initiative.": "提升行動速度或先攻值。",
    "Reduce action speed or initiative.": "降低行動速度或先攻值。",
    "Increase final outgoing damage.": "提升最終輸出傷害。",
    "Reduce final outgoing damage.": "降低最終輸出傷害。",
    "Restore HP over time.": "每回合回復 HP。",
    "Stable damage over time.": "穩定每回合扣血。",
    "Short-duration fire damage over time.": "短時間火焰持續傷害。",
    "Physical damage over time.": "物理持續傷害。",
    "Lightning damage over time.": "雷電持續傷害。",
    "Dark damage over time.": "暗系持續傷害。",
    "Passive HP regeneration.": "被動 HP 自動回復。",
    "Passive MP/SP regeneration.": "被動 MP/SP 自動回復。",
    "Cannot act while stunned.": "無法行動。",
    "Cannot act; often paired with bonus damage.": "無法行動，常搭配額外傷害。",
    "Cannot act until hit or expired.": "無法行動，被打或時間到才解除。",
    "Cannot cast skills.": "無法施放技能。",
    "Cannot move or reposition.": "無法移動或換位。",
    "Reduce speed or frequency of action.": "降低行動速度或頻率。",
    "Lower hit rate significantly.": "大幅降低命中率。",
    "Force target selection.": "強制鎖定攻擊目標。",
    "Chance to skip actions.": "有機率跳過行動。",
    "Act unpredictably.": "行動隨機混亂。",
    "Suppress weapon-based output.": "壓制武器輸出。",
    "Absorb incoming damage.": "吸收受到的傷害。",
    "Specialized shield for certain damage types.": "對特定傷害類型的專屬護盾。",
    "Reduce all incoming damage.": "減少全部受到傷害。",
    "Reduce physical incoming damage.": "減少物理受到傷害。",
    "Reduce magic incoming damage.": "減少魔法受到傷害。",
    "Prevent all damage briefly.": "短時間免疫全部傷害。",
    "Survive a lethal blow once.": "致命一擊時保留 1 點 HP，每場一次。",
    "Low HP survival effect.": "低血量時的生存效果。",
    "Remove negative effects.": "清除負面效果。",
    "Ignore debuffs.": "免疫 Debuff。",
    "Ignore control effects.": "免疫控場效果。",
    "Convert damage dealt into healing.": "將造成的傷害轉為治療。",
    "Restore MP/SP when dealing damage.": "造成傷害時回復 MP/SP。",
    "Reflect damage when hit.": "受擊時反射傷害。",
    "Counterattack when damaged.": "受擊時反擊。",
    "Reflect magic damage or effects.": "反射魔法傷害或效果。",
    "Convert damage taken into healing.": "將受到的傷害轉為治療。",
    "Heal when landing hits.": "造成命中時回血。",
    "Heal on critical strikes.": "爆擊時回血。",
    "Deal more damage to bosses.": "對 BOSS 造成更高傷害。",
    "Conditional damage against poisoned targets.": "對中毒目標額外傷害。",
    "Conditional damage against burning targets.": "對燃燒目標額外傷害。",
    "Conditional damage against stunned targets.": "對擊暈目標額外傷害。",
    "Conditional damage against any debuffed target.": "對任何 Debuff 目標額外傷害。",
    "More damage when current HP is high.": "自身 HP 高時傷害提升。",
    "More damage when current HP is low.": "自身 HP 低時傷害提升。",
    "Bonus damage on first hit of the fight.": "戰鬥第一擊額外傷害。",
    "Increase counterattack damage.": "提升反擊傷害。",
    "Execute or greatly increase damage to low-HP targets.": "對低血量目標斬殺或大幅加傷。",
    "Increase gold rewards.": "提升金幣獎勵。",
    "Increase EXP rewards.": "提升經驗獎勵。",
    "Increase item drop rate.": "提升道具掉落率。",
    "Increase rare item drop rate.": "提升稀有掉落率。",
    "Increase check-in rewards.": "提升簽到獎勵。",
    "Increase enhancement success rate.": "提升強化成功率。",
    "Increase special event trigger chance.": "提升特殊事件觸發率。",
    "Increase monster kill rewards.": "提升怪物獎勵。",
    "Chance to apply stun.": "有機率附加擊暈。",
    "Chance to apply poison.": "有機率附加中毒。",
    "Chance to apply burn.": "有機率附加灼燒。",
    "Chance to apply bleed.": "有機率附加流血。",
    "Chance to apply slow.": "有機率附加緩速。",
    "Chance to apply defense reduction.": "有機率附加防禦降低。",
    "Chance to apply attack reduction.": "有機率附加攻擊降低。",
    "Chance to trigger an extra hit.": "有機率追擊。",
    "Chance to trigger chained hits.": "有機率連擊。",
    "Chance to execute low-HP targets.": "有機率斬殺低血量目標。",
    "Chance to heal self.": "有機率自我治療。",
    "Chance to gain shield.": "有機率獲得護盾。",
    "Chance to remove debuffs.": "有機率移除負面效果。",
    "Chance to remove enemy buffs.": "有機率驅散敵方 Buff。",
    "Chance to gain a self-buff.": "有機率自我獲得 Buff。",
    "Increase attack multiplier.": "提升攻擊倍率。",
    "Increase block chance.": "提升格擋率。",
    "Increase combo hit damage.": "提升連擊傷害。",
    "Increase execute proc chance.": "提升斬殺觸發率。",
    "Increase execute HP threshold.": "提升斬殺血量門檻。",
    "Increase combo trigger chance.": "提升連擊機率。",
    "Increase stun trigger chance.": "提升擊暈機率。",
    "Counterattack after evading.": "閃避後反擊。",
    "Chance to strike a weak spot after a hit.": "命中後有機率打中要害。",
    "Increase party damage output.": "提升隊伍輸出。",
    "Increase strength (STR).": "提升 STR。",
    "Increase critical/weakness hit rate.": "提升要害／爆擊命中率。",
    "Reflect a percentage of received damage back to attacker.": "反射受到的部分傷害。",
    "Increase agility (AGI).": "提升 AGI。",
    "Reduce agility (AGI).": "降低 AGI。",
    "Ignore a percentage of target defense.": "無視目標部分防禦。",
    "Reduce or disturb target damage output.": "降低或干擾目標輸出。",
    "Reduce target combat power.": "降低目標戰鬥力。",
    "Increase party damage against bosses.": "提升隊伍對 BOSS 傷害。",
    "Reduce monster defense for party members.": "降低隊伍面對的怪物防禦。",
    "Reduce incoming damage for party members.": "降低隊伍受到的傷害。",
    "Reduce incoming critical damage for party members.": "降低隊伍受到的爆擊傷害。",
    "Increase party EXP rewards.": "提升隊伍經驗獎勵。",
    "Increase party gold rewards.": "提升隊伍金幣獎勵。",
    "Increase party agility.": "提升隊伍 AGI。",
  };
  return m[en] || en;
}

// ── 白話公式工具：給定六屬性欄位的起始字母，產出 STR+x AGI+y... 的子公式 ──
function statFormulaParts(r, startCol) {
  const labels = ["STR", "AGI", "VIT", "INT", "DEX", "LUK"];
  const start = startCol.charCodeAt(0);
  return labels.map((lab, i) => {
    const col = String.fromCharCode(start + i);
    return `IF(${col}${r}="","","${lab}+"&${col}${r})`;
  });
}

function weaponTypeLabel(w) {
  return ({
    sword_1h: "單手劍",
    sword_2h: "雙手劍",
    axe_1h: "單手斧",
    axe_2h: "雙手斧",
    mace_1h: "單手槌",
    mace_2h: "雙手槌",
    dagger: "匕首",
    staff_1h: "單手法杖",
    staff_2h: "雙手法杖",
    bow: "弓",
  })[w] || w || "";
}

function slotLabel(s) {
  return ({
    weapon: "武器",
    shield: "盾牌/副手",
    armor: "盔甲",
    garment: "外衣",
    shoes: "鞋子",
    head_top: "頭頂",
    head_mid: "頭中",
    head_low: "頭下",
    accessory_l: "左飾品",
    accessory_r: "右飾品",
    special: "特殊",
    job_eq: "職業徽章",
    title_eq: "稱號",
  })[s] || s || "";
}

function itemEffectStr(effect) {
  if (!effect || !effect.type || effect.type === "none") return "";
  const v = effect.value;
  switch (effect.type) {
    case "grant_diamond": return `使用後獲得 ${v} 鑽石`;
    case "grant_gold": return `使用後獲得 ${v} 金幣`;
    case "tower_heal_flat": return `塔內回復 ${v} HP`;
    case "tower_heal_pct": return `塔內回復 ${v}% HP`;
    case "tower_revive_pct": return `塔內復活並回復 ${v}% HP`;
    case "reroll_attributes": return "重置屬性點";
    case "level_down_random_attributes": return `隨機降低 ${v} 點屬性`;
    default: return `${effect.type}=${v}`;
  }
}

// 裝備特效摘要：把 passive/proc/combat effects 整理成中文一行（給「特效說明」欄）
function gearEffectSummary(item) {
  const all = [
    ...(Array.isArray(item.passiveEffects) ? item.passiveEffects : []),
    ...(Array.isArray(item.procEffects) ? item.procEffects : []),
    ...(Array.isArray(item.combatEffects) ? item.combatEffects : []),
  ];
  if (all.length === 0) return "";
  return all.map((e) => {
    const zh = EFFECT_NAME_ZH[e.key] || e.key;
    const v = e.params?.value;
    const dur = e.params?.duration?.value;
    let s = zh;
    if (v != null && v !== 0) s += ` ${v}${e.params?.mode === "flat" ? "" : (e.params?.mode === "pct" ? "%" : "")}`;
    if (e.params?.thresholdPct) s += `（HP<${e.params.thresholdPct}%）`;
    if (dur) s += `／${dur}回合`;
    return s;
  }).join("、");
}

function questTypeStr(type, target) {
  const map = {
    battle_count: `出戰 ${target} 次`,
    battle_win: `勝利 ${target} 場`,
    battle_loss: `敗北 ${target} 場`,
    battle_with_sword: `用劍類武器出戰 ${target} 次`,
    battle_with_axe: `用斧類武器出戰 ${target} 次`,
    battle_with_mace: `用槌類武器出戰 ${target} 次`,
    battle_with_dagger: `用匕首出戰 ${target} 次`,
    battle_with_staff: `用法杖出戰 ${target} 次`,
    battle_with_bow: `用弓出戰 ${target} 次`,
    crit_count: `爆擊 ${target} 次`,
    death_count: `戰敗/死亡 ${target} 次`,
    dodge_count: `閃避 ${target} 次`,
    enhance_count: `強化裝備 ${target} 次`,
    equip_count: `裝備物品 ${target} 次`,
    level_10_job_badge: `達到 Lv.10 並獲得任一職業徽章`,
    onboarding_complete_count: `完成 ${target} 個新手任務`,
    stream_bind_count: `綁定直播帳號 ${target} 次`,
    stun_count: `造成擊暈 ${target} 次`,
    weekly_complete_count: `完成 ${target} 個每週任務`,
  };
  return map[type] || `${type}=${target}`;
}

function rewardStr(q, itemById) {
  const parts = [];
  if (q.rewardGold) parts.push(`${q.rewardGold} 金幣`);
  if (q.rewardExp) parts.push(`${q.rewardExp} EXP`);
  if (q.rewardDiamond) parts.push(`${q.rewardDiamond} 鑽石`);
  if (q.rewardItemId) parts.push(itemById.get(q.rewardItemId)?.name || q.rewardItemId);
  return parts.join(" + ");
}

function unlockAttrStr(q) {
  if (!q) return "";
  const raw = Array.isArray(q.unlockAttributes) && q.unlockAttributes.length > 0
    ? q.unlockAttributes
    : [q.unlockAttribute, q.unlockAttribute2];
  const attrs = raw.map((a) => String(a || "").trim().toUpperCase()).filter(Boolean);
  const uniq = [...new Set(attrs)];
  if (!uniq.length) return "";
  return `${uniq.join(" + ")} > ${q.unlockAttributeMin ?? ""}`;
}

// ── 白話說明（嚴格只用 DB 真實欄位）─────────────────────────────────────────
function monsterDesc(m) {
  const zone = ZONE_BY_KEY[m.zone]?.label || m.zone || "未分區";
  const tags = [];
  if (m.isBoss) tags.push("BOSS");
  if (m.enabled === false) tags.push("停用");
  const tagStr = tags.length ? `（${tags.join("、")}）` : "";
  const parts = [`${zone}${tagStr} Lv.${m.level ?? "?"}`];
  if (m.maxHp) parts.push(`HP ${m.maxHp}`);
  if (m.expReward) parts.push(`EXP ${m.expReward}`);
  if (m.goldReward) parts.push(`金幣 ${m.goldReward}`);
  if (m.entryFee) parts.push(`入場費 ${m.entryFee}`);
  if (Array.isArray(m.drops)) parts.push(`掉落 ${m.drops.length} 種`);
  if (m.monsterCardSkill?.description) parts.push(`怪物卡技能：${m.monsterCardSkill.description}`);
  return parts.join("，");
}

function equipmentDesc(it) {
  const parts = [];
  if (it.tier) parts.push(`${it.tier} 階`);
  if (it.weaponType) parts.push(weaponTypeLabel(it.weaponType));
  if (it.equipSlot) parts.push(`裝備槽：${slotLabel(it.equipSlot)}`);
  if (it.isTwoHanded) parts.push("雙手武器");
  if (it.atkStat) parts.push(`攻擊屬性：${String(it.atkStat).toUpperCase()}`);
  const s = statStr(it.equipStats);
  if (s) parts.push(s);
  const eff = itemEffectStr(it.effect);
  if (eff) parts.push(eff);
  return parts.join("，") || it.description || "";
}

function consumableDesc(it) {
  const eff = itemEffectStr(it.effect);
  if (eff) return eff;
  return it.description || "消耗品";
}

function collectibleDesc(it) {
  return it.description || "收藏品（無使用效果）";
}

function jobBadgeDesc(badge, quest) {
  const parts = [];
  if (badge.tier) parts.push(`${badge.tier} 階徽章`);
  parts.push(`裝備槽：職業徽章`);
  const s = statStr(badge.equipStats);
  if (s) parts.push(s);
  if (badge.description) parts.push(badge.description);
  if (quest) {
    const cond = [];
    if (quest.unlockLevel) cond.push(`Lv.${quest.unlockLevel}`);
    const attr = unlockAttrStr(quest);
    if (attr) cond.push(`基礎屬性 ${attr}`);
    if (Array.isArray(quest.unlockWeaponTypes) && quest.unlockWeaponTypes.length) {
      cond.push(`使用武器：${quest.unlockWeaponTypes.map(weaponTypeLabel).join("、")}`);
    }
    if (cond.length) parts.push(`取得條件：${cond.join("、")}`);
  }
  return parts.join("，");
}

function questDesc(q, itemById) {
  const cadence = ({
    onboarding: "新手任務",
    job: "職業試煉",
    daily: "每日任務",
    weekly: "每週任務",
  })[q.cadence] || q.cadence || "任務";
  const action = questTypeStr(q.type, q.target);
  const reward = rewardStr(q, itemById);
  const parts = [`${cadence}：${action}`];
  if (reward) parts.push(`獎勵：${reward}`);
  if (q.description) parts.push(q.description);
  if (q.levelLimit) parts.push(`等級上限 ${q.levelLimit}`);
  return parts.join("，");
}

function zoneDesc(z, monsters) {
  const zoneMons = monsters.filter((m) => m.zone === z.key);
  const bosses = zoneMons.filter((m) => m.isBoss);
  const maxLv = z.maxLevel == null ? "無上限" : `Lv.${z.maxLevel}`;
  const parts = [`等級範圍 Lv.${z.minLevel}～${maxLv}`, `怪物 ${zoneMons.length} 隻（含 ${bosses.length} BOSS）`];
  if (z.defaultEntryFee) parts.push(`入場費 ${z.defaultEntryFee}`);
  if (z.tagline) parts.push(z.tagline);
  return parts.join("，");
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
async function main() {
  const db = await getMongoDb();
  const [monsterDocs, items, quests, players, progressRows, wbCfg, wbState, shopRows, effectDoc] = await Promise.all([
    db.collection("monsters").find({}).sort({ zone: 1, seq: 1, level: 1, name: 1 }).toArray(),
    db.collection("items").find({}).sort({ itemType: 1, tier: 1, equipSlot: 1, name: 1 }).toArray(),
    db.collection("weeklyQuests").find({}).sort({ cadence: 1, sortOrder: 1, title: 1 }).toArray(),
    db.collection("players").countDocuments(),
    db.collection("progress").countDocuments(),
    db.collection("worldBossConfig").find({}).toArray(),
    db.collection("worldBossState").find({}).toArray().catch(() => []),
    db.collection("shopItems").find({}).sort({ currency: 1, price: 1, name: 1 }).toArray(),
    db.collection("effectDefinitions").findOne({}),
  ]);
  const effectDefs = (effectDoc?.value?.definitions || effectDoc?.definitions || []);

  const monsters = monsterDocs.filter((m) => !String(m._id || "").startsWith("monsterState:"));
  const monsterStateCount = monsterDocs.length - monsters.length;

  const itemById = new Map();
  for (const it of items) {
    if (it.id) itemById.set(String(it.id), it);
    if (it._id) itemById.set(String(it._id), it);
  }

  const jobBadges = items.filter((it) => it.itemType === "job_badge" || it.equipSlot === "job_eq");
  // 純裝備：排除怪物卡（special 槽 / monsterCardOf）與職業徽章，避免混進裝備分頁
  const equipments = items.filter((it) => it.itemType === "equipment"
    && !it.monsterCardOf
    && !/^special/.test(it.equipSlot || "")
    && it.equipSlot !== "job_eq");
  const consumables = items.filter((it) => it.itemType === "consumable");
  const collectibles = items.filter((it) => it.itemType === "collectible");

  const jobQuests = quests.filter((q) => q.cadence === "job");
  const onboardingQuests = quests.filter((q) => q.cadence === "onboarding");
  const dailyQuests = quests.filter((q) => q.cadence === "daily");
  const weeklyQuests = quests.filter((q) => q.cadence === "weekly");

  // 各分頁定義
  const sheets = {};

  // 1. 總覽
  sheets["總覽"] = {
    headers: ["項目", "數量", "白話說明"],
    rows: [
      ["玩家", players, "資料庫內已建檔的玩家總數"],
      ["進度資料", progressRows, "玩家進度文件（含等級、屬性、裝備）"],
      ["怪物", monsters.length, "怪物原型數量（不含 monsterState 狀態文件）"],
      ["怪物狀態文件", monsterStateCount, "monsterState 開頭的狀態快照"],
      ["道具", items.length, `含 ${equipments.length} 裝備、${consumables.length} 消耗品、${collectibles.length} 收藏品、${jobBadges.length} 職業徽章`],
      ["任務", quests.length, `新手 ${onboardingQuests.length} / 職業 ${jobQuests.length} / 每日 ${dailyQuests.length} / 每週 ${weeklyQuests.length}`],
      ["職業徽章", jobBadges.length, "10 個職業專屬徽章（job_eq 槽位）"],
      ["職業試煉", jobQuests.length, "對應每個職業徽章的取得任務"],
      ["世界王設定", wbCfg.length, "目前的世界王設定文件"],
      ["世界王狀態", wbState.length, "當週世界王擊殺累計與解鎖狀態"],
      ["商店道具", shopRows.length, "shopItems 集合內的商店上架物品"],
      ["戰鬥效果定義", effectDefs.length, "effectDefinitions.definitions 內的 Buff/Debuff 全表"],
    ],
  };

  // 2. 區域 — A=key B=名稱 C=min D=max E=入場費 F=怪物 G=BOSS H=白話
  sheets["區域"] = {
    headers: ["Zone Key", "名稱", "最低等級", "最高等級", "預設入場費", "怪物數", "BOSS 數", "白話說明"],
    rows: ZONE_DEFS.map((z, idx) => {
      const r = idx + 2;
      const zoneMons = monsters.filter((m) => m.zone === z.key);
      const bosses = zoneMons.filter((m) => m.isBoss).length;
      const formula = `=TEXTJOIN("，",TRUE,"等級範圍 Lv."&C${r}&"～"&IF(D${r}="無上限","無上限","Lv."&D${r}),"怪物 "&F${r}&" 隻（含 "&G${r}&" BOSS）",IF(E${r}=0,"","入場費 "&E${r}))`;
      return [
        z.key,
        z.label,
        z.minLevel,
        z.maxLevel == null ? "無上限" : z.maxLevel,
        z.defaultEntryFee || 0,
        zoneMons.length,
        bosses,
        formula,
      ];
    }),
  };

  // 3. 怪物 — A=Zone B=序號 C=名稱 D=等級 E=HP F=EXP G=金幣 H=入場費 I=BOSS J=啟用 K=掉落數 L=白話
  sheets["怪物"] = {
    headers: ["Zone", "序號", "名稱", "等級", "HP", "EXP", "金幣", "入場費", "BOSS", "啟用", "掉落數", "白話說明"],
    rows: monsters.map((m, idx) => {
      const r = idx + 2;
      const formula = `=TEXTJOIN("，",TRUE,A${r}&IF(I${r}="是","（BOSS）",IF(J${r}="停用","（停用）",""))&" Lv."&D${r},IF(E${r}="","","HP "&E${r}),IF(F${r}="","","EXP "&F${r}),IF(G${r}="","","金幣 "&G${r}),IF(OR(H${r}="",H${r}=0),"","入場費 "&H${r}),IF(K${r}="","","掉落 "&K${r}&" 種"))`;
      return [
        m.zone || "未分區",
        m.seq ?? "",
        m.name || "",
        m.level ?? "",
        m.maxHp ?? "",
        m.expReward ?? "",
        m.goldReward ?? "",
        m.entryFee ?? 0,
        m.isBoss ? "是" : "否",
        m.enabled === false ? "停用" : "啟用",
        Array.isArray(m.drops) ? m.drops.length : 0,
        formula,
      ];
    }),
  };

  // 4. 道具-裝備 — A=ID B=名稱 C=階級 D=槽位 E=武器類型 F=雙手 G=攻擊屬性 H-M=STR..LUK N=特效 O=特效說明 P=白話
  sheets["道具-裝備"] = {
    headers: ["ID", "名稱", "階級", "槽位", "武器類型", "雙手", "攻擊屬性", "STR", "AGI", "VIT", "INT", "DEX", "LUK", "特效", "特效說明", "白話說明"],
    rows: equipments.map((it, idx) => {
      const r = idx + 2;
      const stat = statFormulaParts(r, "H").join(",");
      const fxSummary = gearEffectSummary(it);
      // 白話：含階級/槽位/屬性，若有特效附在後面
      const formula = `=TEXTJOIN("，",TRUE,IF(C${r}="","",C${r}&" 階"),E${r},IF(D${r}="","","裝備槽："&D${r}),IF(F${r}="是","雙手武器",""),IF(G${r}="","","攻擊屬性："&G${r}),${stat},IF(O${r}="","","✨特效："&O${r}))`;
      return [
        it.id || "",
        it.name || "",
        it.tier || "",
        slotLabel(it.equipSlot),
        weaponTypeLabel(it.weaponType),
        it.isTwoHanded ? "是" : "",
        it.atkStat ? String(it.atkStat).toUpperCase() : "",
        ...statCells(it.equipStats),
        fxSummary ? "✨有" : "",
        fxSummary,
        formula,
      ];
    }),
  };

  // 5. 道具-消耗品 — A=ID B=名稱 C=效果類型 D=效果數值 E=白話
  sheets["道具-消耗品"] = {
    headers: ["ID", "名稱", "效果類型", "效果數值", "白話說明"],
    rows: consumables.map((it, idx) => {
      const r = idx + 2;
      const formula = `=IFS(`
        + `C${r}="grant_diamond","使用後獲得 "&D${r}&" 鑽石",`
        + `C${r}="grant_gold","使用後獲得 "&D${r}&" 金幣",`
        + `C${r}="tower_heal_flat","塔內回復 "&D${r}&" HP",`
        + `C${r}="tower_heal_pct","塔內回復 "&D${r}&"% HP",`
        + `C${r}="tower_revive_pct","塔內復活並回復 "&D${r}&"% HP",`
        + `C${r}="reroll_attributes","重置屬性點",`
        + `C${r}="level_down_random_attributes","隨機降低 "&D${r}&" 點屬性",`
        + `C${r}="none","無使用效果",`
        + `C${r}="","無使用效果",`
        + `TRUE,C${r}&"="&D${r})`;
      return [
        it.id || "",
        it.name || "",
        it.effect?.type || "",
        it.effect?.value ?? "",
        formula,
      ];
    }),
  };

  // 6. 道具-收藏品
  sheets["道具-收藏品"] = {
    headers: ["ID", "名稱", "描述", "白話說明"],
    rows: collectibles.map((it) => [
      it.id || "",
      it.name || "",
      it.description || "",
      collectibleDesc(it),
    ]),
  };

  // 7. 道具-職業徽章 — A=ID B=名稱 C=階級 D-I=STR..LUK J=白話
  sheets["道具-職業徽章"] = {
    headers: ["ID", "名稱", "階級", "STR", "AGI", "VIT", "INT", "DEX", "LUK", "白話說明"],
    rows: jobBadges.map((b, idx) => {
      const r = idx + 2;
      const stat = statFormulaParts(r, "D").join(",");
      const formula = `=TEXTJOIN("，",TRUE,IF(C${r}="","",C${r}&" 階徽章"),"裝備槽：職業徽章",${stat})`;
      return [
        b.id || "",
        b.name || "",
        b.tier || "",
        ...statCells(b.equipStats),
        formula,
      ];
    }),
  };

  // 8-11. 任務分類 — A=排序 B=標題 C=Metric D=目標 E=狀態 F=獎勵 G=解鎖等級 H=屬性條件 I=白話
  const QUEST_METRIC_FORMULA = (r) => `IFS(`
    + `C${r}="battle_count","出戰 "&D${r}&" 次",`
    + `C${r}="battle_win","勝利 "&D${r}&" 場",`
    + `C${r}="battle_loss","敗北 "&D${r}&" 場",`
    + `C${r}="crit_count","爆擊 "&D${r}&" 次",`
    + `C${r}="death_count","戰敗/死亡 "&D${r}&" 次",`
    + `C${r}="dodge_count","閃避 "&D${r}&" 次",`
    + `C${r}="enhance_count","強化裝備 "&D${r}&" 次",`
    + `C${r}="equip_count","裝備物品 "&D${r}&" 次",`
    + `C${r}="stun_count","造成擊暈 "&D${r}&" 次",`
    + `C${r}="onboarding_complete_count","完成 "&D${r}&" 個新手任務",`
    + `C${r}="stream_bind_count","綁定直播帳號 "&D${r}&" 次",`
    + `C${r}="weekly_complete_count","完成 "&D${r}&" 個每週任務",`
    + `C${r}="level_10_job_badge","達到 Lv.10 並獲得任一職業徽章",`
    + `C${r}="battle_with_sword","用劍類武器出戰 "&D${r}&" 次",`
    + `C${r}="battle_with_axe","用斧類武器出戰 "&D${r}&" 次",`
    + `C${r}="battle_with_mace","用槌類武器出戰 "&D${r}&" 次",`
    + `C${r}="battle_with_dagger","用匕首出戰 "&D${r}&" 次",`
    + `C${r}="battle_with_staff","用法杖出戰 "&D${r}&" 次",`
    + `C${r}="battle_with_bow","用弓出戰 "&D${r}&" 次",`
    + `TRUE,C${r}&"="&D${r})`;
  const buildQuestSheet = (rows, cadenceLabel) => ({
    headers: ["排序", "標題", "Metric", "目標", "狀態", "獎勵", "解鎖等級", "解鎖屬性條件", "白話說明"],
    rows: rows.map((q, idx) => {
      const r = idx + 2;
      const formula = `=TEXTJOIN("，",TRUE,"${cadenceLabel}："&${QUEST_METRIC_FORMULA(r)},IF(F${r}="","","獎勵："&F${r}),IF(G${r}="","","解鎖 Lv."&G${r}),IF(H${r}="","",H${r}),IF(E${r}="停用","(停用)",""))`;
      return [
        q.sortOrder ?? "",
        q.title || "",
        q.type || "",
        q.target ?? "",
        q.enabled === false ? "停用" : "啟用",
        rewardStr(q, itemById),
        q.unlockLevel ?? "",
        unlockAttrStr(q),
        formula,
      ];
    }),
  });
  sheets["任務-新手"] = buildQuestSheet(onboardingQuests, "新手任務");
  sheets["任務-職業"] = buildQuestSheet(jobQuests, "職業試煉");
  sheets["任務-每日"] = buildQuestSheet(dailyQuests, "每日任務");
  sheets["任務-每週"] = buildQuestSheet(weeklyQuests, "每週任務");

  // 12. 職業 — A=ID B=名稱 C=階級 D-I=STR..LUK J=試煉 K=狀態 L=解鎖等級 M=武器條件 N=屬性條件 O=獎勵 P=白話
  sheets["職業"] = {
    headers: ["徽章ID", "職業徽章", "階級", "STR", "AGI", "VIT", "INT", "DEX", "LUK", "對應試煉", "試煉狀態", "解鎖等級", "武器條件", "屬性條件", "獎勵", "白話說明"],
    rows: jobBadges.map((b, idx) => {
      const q = jobQuests.find((row) => row.rewardItemId === b.id);
      const r = idx + 2;
      const stat = statFormulaParts(r, "D").join(",");
      const formula = `=TEXTJOIN("，",TRUE,IF(C${r}="","",C${r}&" 階徽章"),${stat},IF(L${r}="","","取得條件：Lv."&L${r}),IF(M${r}="","","武器："&M${r}),IF(N${r}="","",N${r}),IF(O${r}="","","獎勵："&O${r}))`;
      return [
        b.id || "",
        b.name || "",
        b.tier || "",
        ...statCells(b.equipStats),
        q?.title || "",
        q ? (q.enabled === false ? "停用" : "啟用") : "無任務",
        q?.unlockLevel ?? "",
        Array.isArray(q?.unlockWeaponTypes) ? q.unlockWeaponTypes.map(weaponTypeLabel).join("、") : "",
        unlockAttrStr(q),
        q ? rewardStr(q, itemById) : "",
        formula,
      ];
    }),
  };

  // 13. 怪物卡（special slot items with monsterCardOf）— 玩家可裝備的怪物卡
  const monsterCardItems = items.filter((it) => it.equipSlot === "special" && it.monsterCardOf);
  const monsterById = new Map(monsters.map((m) => [String(m.id || m._id || ""), m]));
  sheets["怪物卡"] = {
    headers: ["卡片ID", "卡片名稱", "階級", "來源怪物", "STR", "AGI", "VIT", "INT", "DEX", "LUK", "技能名稱", "技能描述", "觸發時機", "發動機率%", "冷卻回合", "白話說明"],
    rows: monsterCardItems.map((c, idx) => {
      const r = idx + 2;
      const src = monsterById.get(String(c.monsterCardOf));
      const sk = c.monsterCardSkill || {};
      const stat = statFormulaParts(r, "E").join(",");
      const formula = `=TEXTJOIN("，",TRUE,IF(C${r}="","",C${r}&" 階怪物卡"),IF(D${r}="","","來源："&D${r}),${stat},IF(K${r}="","",K${r}&IF(M${r}="","","（"&M${r}&IF(N${r}="","","、機率"&N${r}&"%")&IF(O${r}=0,"",IF(O${r}="","","、CD "&O${r}&"回合"))&"）")),IF(L${r}="","",L${r}))`;
      return [
        c.id || "",
        c.name || "",
        c.tier || "",
        src?.name || c.monsterCardOf || "",
        ...statCells(c.equipStats),
        sk.name || "",
        sk.description || "",
        sk.trigger || "",
        sk.chance ?? "",
        sk.cooldownTurns ?? 0,
        formula,
      ];
    }),
  };

  // 14. 怪物技能（monster doc 上的 monsterCardSkill；戰鬥中怪物自己會用的技能）
  const monstersWithSkill = monsters.filter((m) => m.monsterCardSkill && (m.monsterCardSkill.name || m.monsterCardSkill.description));
  sheets["怪物技能"] = {
    headers: ["Zone", "怪物", "等級", "BOSS", "技能名稱", "技能描述", "觸發時機", "發動機率%", "冷卻回合", "白話說明"],
    rows: monstersWithSkill.map((m, idx) => {
      const r = idx + 2;
      const sk = m.monsterCardSkill || {};
      const formula = `=TEXTJOIN("，",TRUE,B${r}&"（"&A${r}&" Lv."&C${r}&IF(D${r}="是" ,"·BOSS","")&"）",IF(E${r}="","",E${r}),IF(G${r}="","",G${r}&IF(H${r}="","","·機率"&H${r}&"%")&IF(I${r}=0,"",IF(I${r}="","","·CD "&I${r}&"回合"))),IF(F${r}="","",F${r}))`;
      return [
        m.zone || "",
        m.name || "",
        m.level ?? "",
        m.isBoss ? "是" : "否",
        sk.name || "",
        sk.description || "",
        sk.trigger || "",
        sk.chance ?? "",
        sk.cooldownTurns ?? 0,
        formula,
      ];
    }),
  };

  // 15. 職業技能（jobSkills on each badge）
  const jobSkillRows = [];
  for (const b of jobBadges) {
    const skills = Array.isArray(b.jobSkills) ? b.jobSkills : [];
    for (const sk of skills) {
      jobSkillRows.push({ badge: b, sk });
    }
  }
  sheets["職業技能"] = {
    headers: ["職業徽章", "技能Key", "技能名稱", "描述", "冷卻回合", "觸發條件", "白話說明"],
    rows: jobSkillRows.map(({ badge, sk }, idx) => {
      const r = idx + 2;
      const condStr = (() => {
        const c = sk.condition || {};
        const parts = [];
        if (c.ownerHpBelowPct != null) parts.push(`自身 HP 低於 ${c.ownerHpBelowPct}%`);
        if (c.ownerHpAbovePct != null) parts.push(`自身 HP 高於 ${c.ownerHpAbovePct}%`);
        if (c.weaponType) parts.push(`武器：${weaponTypeLabel(c.weaponType)}`);
        if (c.equippedSlot) parts.push(`裝備槽：${slotLabel(c.equippedSlot)}`);
        return parts.join("、");
      })();
      const formula = `=TEXTJOIN("，",TRUE,A${r}&"·"&C${r},IF(D${r}="","",D${r}),IF(E${r}=0,"",IF(E${r}="","","冷卻 "&E${r}&" 回合")),IF(F${r}="","",F${r}))`;
      return [
        badge.name || "",
        sk.key || "",
        sk.name || "",
        sk.description || "",
        sk.cooldownTurns ?? 0,
        condStr,
        formula,
      ];
    }),
  };

  // 16. 戰鬥效果（Buff/Debuff 全表）— effectDefinitions.definitions
  sheets["戰鬥效果"] = {
    headers: ["Key", "中文名稱", "分類", "疊加方式", "持續模式", "可來源", "白話說明", "備註"],
    rows: effectDefs.map((d, idx) => {
      const r = idx + 2;
      const formula = `=TEXTJOIN("，",TRUE,B${r}&"（"&A${r}&"）",IF(C${r}="","",C${r}),IF(D${r}="","","疊加方式："&D${r}),IF(E${r}="","","持續："&E${r}),IF(F${r}="","","來源："&F${r}),IF(H${r}="","",H${r}))`;
      return [
        d.key || "",
        EFFECT_NAME_ZH[d.key] || d.name || "",
        EFFECT_CATEGORY_ZH[d.category] || d.category || "",
        STACK_MODE_ZH[d.stackMode] || d.stackMode || "",
        Array.isArray(d.durationModes) ? d.durationModes.map((x) => DURATION_MODE_ZH[x] || x).join("、") : "",
        Array.isArray(d.sourceTypes) ? d.sourceTypes.map((x) => SOURCE_TYPE_ZH[x] || x).join("、") : "",
        formula,
        translateNote(d.notes),
      ];
    }),
  };

  // 17. 商店 — shopItems
  sheets["商店"] = {
    headers: ["ID", "名稱", "幣別", "價格", "庫存", "上架", "特價", "月限購", "效果類型", "效果數值", "白話說明"],
    rows: shopRows.map((s, idx) => {
      const r = idx + 2;
      const formula = `=TEXTJOIN("，",TRUE,B${r}&"（"&D${r}&" "&C${r}&"）",IF(F${r}="否","下架",""),IF(G${r}="是","特價中",""),IF(E${r}=-1,"無限庫存","庫存 "&E${r}),IF(H${r}=0,"","月限購 "&H${r}),IFS(I${r}="grant_diamond","使用後獲得 "&J${r}&" 鑽石",I${r}="grant_gold","使用後獲得 "&J${r}&" 金幣",I${r}="reroll_attributes","重置屬性點",I${r}="tower_heal_flat","塔內回復 "&J${r}&" HP",I${r}="tower_heal_pct","塔內回復 "&J${r}&"% HP",I${r}="tower_revive_pct","塔內復活並回復 "&J${r}&"% HP",I${r}="level_down_random_attributes","隨機降低 "&J${r}&" 點屬性",I${r}="","",TRUE,I${r}&"="&J${r}))`;
      return [
        s.id || "",
        s.name || "",
        s.currency || "",
        s.price ?? "",
        s.stock ?? "",
        s.enabled === false ? "否" : "是",
        s.isSale ? "是" : "否",
        s.maxPerMonth ?? 0,
        s.effect?.type || "",
        s.effect?.value ?? "",
        formula,
      ];
    }),
  };

  // 18. 掉落表 — 每個怪物的每個 drop 一列
  const dropRows = [];
  for (const m of monsters) {
    if (!Array.isArray(m.drops)) continue;
    for (const d of m.drops) {
      dropRows.push({ m, d });
    }
  }
  sheets["掉落表"] = {
    headers: ["Zone", "怪物", "怪物等級", "BOSS", "道具", "掉落機率%", "來源類型", "白話說明"],
    rows: dropRows.map(({ m, d }, idx) => {
      const r = idx + 2;
      const formula = `=TEXTJOIN("，",TRUE,B${r}&"（"&A${r}&" Lv."&C${r}&IF(D${r}="是","·BOSS","")&"）掉落 "&E${r}&" 機率 "&F${r}&"%",IF(G${r}="","",G${r}))`;
      return [
        m.zone || "",
        m.name || "",
        m.level ?? "",
        m.isBoss ? "是" : "否",
        d.itemName || d.itemId || "",
        Number(d.chance) || 0,
        d.source || "",
        formula,
      ];
    }),
  };

  // 19. 世界王
  const wbRows = [];
  for (const cfg of wbCfg) {
    const v = cfg.value || cfg;
    wbRows.push([
      "設定",
      cfg._id || "",
      v.enabled ? "啟用" : "停用",
      v.targetZone || "",
      v.eliteZoneKey || "",
      v.battleTimeLimitMinutes ?? "",
      v.respawnCooldownMinutes ?? "",
      v.weeklyUnlockKillTarget ?? "",
      Array.isArray(v.phaseConfig) ? v.phaseConfig.length : 0,
      `目標區 ${v.targetZone || "?"}，精英區 ${v.eliteZoneKey || "?"}，戰鬥時限 ${v.battleTimeLimitMinutes ?? "?"} 分，重生冷卻 ${v.respawnCooldownMinutes ?? "?"} 分，週解鎖擊殺 ${v.weeklyUnlockKillTarget ?? "?"} 隻，共 ${Array.isArray(v.phaseConfig) ? v.phaseConfig.length : 0} 階段`,
    ]);
  }
  for (const st of wbState) {
    const v = st.value || st;
    wbRows.push([
      "狀態",
      st._id || "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      `週 ${v.weekKey || "?"}，hard 區擊殺 ${v.hardKills ?? 0}，解鎖時間 ${v.unlockedAt || "未解鎖"}，上次擊殺 ${v.lastKilledAt || "無"}`,
    ]);
  }
  sheets["世界王"] = {
    headers: ["類型", "ID", "啟用", "目標區", "精英區", "戰鬥時限(分)", "重生冷卻(分)", "週解鎖擊殺", "階段數", "白話說明"],
    rows: wbRows,
  };

  // ── POST 到 Apps Script ────────────────────────────────────────────────
  console.log("各分頁筆數：");
  for (const [name, s] of Object.entries(sheets)) {
    console.log(`  ${name}: ${s.rows.length}`);
  }

  const payload = JSON.stringify({ token: SECRET, sheets });
  console.log(`\nPOST ${SHEET_URL}  (${(payload.length / 1024).toFixed(1)} KB)`);

  const res = await fetch(SHEET_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    redirect: "follow",
  });
  const text = await res.text();
  console.log(`HTTP ${res.status}`);
  console.log(text);
  if (!res.ok) throw new Error(`Sheet write failed: ${res.status}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
