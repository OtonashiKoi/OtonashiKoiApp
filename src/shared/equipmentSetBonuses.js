"use strict";

/**
 * 具名套裝系統（named set bonuses）。
 * 每件裝備可帶 setKey/setName；穿同 setKey 越多件、達到門檻(3/5/7)給對應加成。
 *
 * 兩種加成型態（每個 tier 擇一或並用）：
 *   - numeric：直接併進 combatStats 的 tierSetBonuses 物件（finalDamagePct/bossDamagePct/dropPct…）
 *   - effects：effect-engine 效果物件（可帶 condition，如火焰只在特定 zone 減傷），注入戰鬥被動收集
 *
 * 新增一套：在 SET_DEFS 加一筆 + 幫裝備標 setKey 即可。
 */

const SET_SLOTS = [
  "weapon", "shield", "head_top", "head_mid", "head_low",
  "armor", "garment", "shoes", "accessory_l", "accessory_r",
];

const HELLFIRE_ZONES = ["hellfire", "hellfire_depths"];
const DRAGON_ZONES = ["dragon_realm", "dragon_king_lair"];

// effect-engine 被動效果小工具（可帶 condition 與額外 params）
function passiveEff(key, value, condition, extraParams) {
  const e = {
    key, target: "self", trigger: "passive", chance: 100, stacks: 1, stackMode: "replace",
    duration: { mode: "battle", value: 1 }, params: { value, ...(extraParams || {}) }, sourcePhase: "set_bonus",
  };
  if (condition) e.condition = condition;
  return e;
}

// ── 套裝登錄表 ───────────────────────────────────────────────
// tiers：count 門檻由小到大；達到即累加（達 5 亦享 3 的加成）。
const SET_DEFS = {
  // ═══ 基礎階級套（各期主力，接替舊 D/C/B/A 階級套裝）═══
  basic_d: {
    name: "新手套裝",
    tiers: [
      { count: 3, desc: "STR/INT/DEX +2", numeric: { stats: { str: 2, int: 2, dex: 2 } } },
      { count: 5, desc: "金幣 +10%", numeric: { goldPct: 10 } },
      { count: 7, desc: "EXP +10%", numeric: { expPct: 10 } },
    ],
  },
  basic_c: {
    name: "皮鐵套裝",
    tiers: [
      { count: 3, desc: "迴避 +8%", numeric: { dodgePct: 8 } },
      { count: 5, desc: "傷害 +5%", numeric: { damagePct: 5 } },
      { count: 7, desc: "命中 +10%", numeric: { hitPct: 10 } },
    ],
  },
  basic_b: {
    name: "鋼製套裝",
    tiers: [
      { count: 3, desc: "傷害 +8%", numeric: { damagePct: 8 } },
      { count: 5, desc: "爆擊率 +5%", numeric: { critRatePct: 5 } },
      { count: 7, desc: "爆擊傷害 +10%", numeric: { critDamagePct: 10 } },
    ],
  },
  mithril: {
    name: "秘銀套裝",
    tiers: [
      { count: 3, desc: "最終傷害 +5%", numeric: { finalDamagePct: 5 } },
      { count: 5, desc: "對 Boss 傷害 +10%", numeric: { bossDamagePct: 10 } },
      { count: 7, desc: "掉落率 +10%", numeric: { dropPct: 10 } },
    ],
  },
  steel: {
    name: "鋼鐵套裝",
    note: "定位：A 階防禦肉盾（6 件防具）",
    tiers: [
      { count: 3, desc: "受到傷害 -6%", effects: () => [passiveEff("damage_reduction", 6)] },
      { count: 5, desc: "最大生命 +10%", effects: () => [passiveEff("max_hp_multiplier_up", 10)] },
      { count: 6, desc: "受到傷害 -6%（疊加）", effects: () => [passiveEff("damage_reduction", 6)] },
    ],
  },
  hellfire: {
    name: "焚獄套裝",
    note: "定位：基礎傷害 + 火焰區防禦",
    tiers: [
      { count: 3, desc: "傷害 +13%", numeric: { damagePct: 13 } },
      { count: 5, desc: "爆擊傷害 +10%", numeric: { critDamagePct: 10 } },
      { count: 7, desc: "地獄火焰／焰獄深處 受傷 -15%", effects: () => [
        passiveEff("physical_damage_reduction", 15, { zone: HELLFIRE_ZONES }),
        passiveEff("magic_damage_reduction", 15, { zone: HELLFIRE_ZONES }),
      ] },
    ],
  },
  dragonscale: {
    name: "龍鱗套裝",
    note: "定位：連擊 + 龍族區防禦",
    tiers: [
      { count: 3, desc: "連擊率 +8", effects: () => [passiveEff("combo_up", 8)] },
      { count: 5, desc: "連擊傷害 +12%", effects: () => [passiveEff("combo_damage_up", 12)] },
      { count: 7, desc: "龍族之領／龍王巢穴 受傷 -15%", effects: () => [
        passiveEff("physical_damage_reduction", 15, { zone: DRAGON_ZONES }),
        passiveEff("magic_damage_reduction", 15, { zone: DRAGON_ZONES }),
      ] },
    ],
  },

  // ═══ 三紋流派套（跨階通算 D~A；戒指同時計入所屬階級基礎套）═══
  swift: {
    name: "迅紋套裝",
    tiers: [
      { count: 3, desc: "迴避 +5%", numeric: { dodgePct: 5 } },
      { count: 5, desc: "連擊率 +6", effects: () => [passiveEff("combo_up", 6)] },
      { count: 7, desc: "迴避 +8%、速度 +10", numeric: { dodgePct: 8 }, effects: () => [passiveEff("speed_up", 10)] },
    ],
  },
  might: {
    name: "鬥紋套裝",
    tiers: [
      { count: 3, desc: "傷害 +5%", numeric: { damagePct: 5 } },
      { count: 5, desc: "爆擊率 +5%", numeric: { critRatePct: 5 } },
      { count: 7, desc: "傷害 +8%", numeric: { damagePct: 8 } },
    ],
  },
  sage: {
    name: "智紋套裝",
    tiers: [
      { count: 3, desc: "最終傷害 +4%", numeric: { finalDamagePct: 4 } },
      { count: 5, desc: "命中 +10%", numeric: { hitPct: 10 } },
      { count: 7, desc: "最終傷害 +6%、無視防禦 +10%", numeric: { finalDamagePct: 6 }, effects: () => [passiveEff("def_ignore", 10)] },
    ],
  },

  // ═══ 特效戒指套（左+右 2 件成套；跨階通算；同時計入所屬階級基礎套）═══
  ring_gale:   { name: "疾風之誓", tiers: [{ count: 2, desc: "迴避 +6%、連擊率 +4", numeric: { dodgePct: 6 }, effects: () => [passiveEff("combo_up", 4)] }] },
  ring_hunter: { name: "獵手之誓", tiers: [{ count: 2, desc: "命中 +8%、爆擊率 +4%", numeric: { hitPct: 8, critRatePct: 4 } }] },
  ring_frenzy: { name: "狂血之誓", tiers: [{ count: 2, desc: "HP<30% 時傷害 +12%", effects: () => [passiveEff("bonus_when_hp_low", 12, null, { thresholdPct: 30 })] }] },
  ring_leech:  { name: "吸血之誓", tiers: [{ count: 2, desc: "吸血 +4%", effects: () => [passiveEff("lifesteal", 4)] }] },
  ring_mirror: { name: "鏡映之誓", tiers: [{ count: 2, desc: "反彈傷害 +8%", effects: () => [passiveEff("reflect_damage", 8)] }] },
  ring_mercy:  { name: "救護之誓", tiers: [{ count: 2, desc: "每回合回復 2% MaxHP", effects: () => [passiveEff("life_regen", 2)] }] },
  ring_smash:  { name: "重擊之誓", tiers: [{ count: 2, desc: "爆擊傷害 +10%", numeric: { critDamagePct: 10 } }] },
  ring_guard:  { name: "守護之誓", tiers: [{ count: 2, desc: "受到傷害 -5%", effects: () => [passiveEff("damage_reduction", 5)] }] },
  ring_valor:  { name: "戰意之誓", tiers: [{ count: 2, desc: "傷害 +5%", numeric: { damagePct: 5 } }] },
};

const EMPTY_NUMERIC = Object.freeze({
  stats: Object.freeze({ str: 0, int: 0, dex: 0 }),
  hitPct: 0, dodgePct: 0, critRatePct: 0, critDamagePct: 0,
  damagePct: 0, finalDamagePct: 0, bossDamagePct: 0,
  goldPct: 0, expPct: 0, dropPct: 0,
});

/** 取得一件裝備所屬的所有套裝 key（支援複合歸屬：setKeys 陣列 > 單一 setKey）。 */
function setKeysOf(item) {
  if (!item) return [];
  if (Array.isArray(item.setKeys) && item.setKeys.length) return item.setKeys.map(String);
  if (item.setKey) return [String(item.setKey)];
  return [];
}

/** 統計身上各 setKey 件數（只算會被套裝計入的槽位；一件可同時計入多套）。 */
function countEquippedSets(equipped = {}) {
  const counts = {};
  const pieces = {};
  if (!equipped || typeof equipped !== "object") return { counts, pieces };
  for (const slot of SET_SLOTS) {
    const it = equipped[slot];
    for (const key of setKeysOf(it)) {
      if (!SET_DEFS[key]) continue;
      counts[key] = (counts[key] || 0) + 1;
      (pieces[key] = pieces[key] || []).push(it.itemName || it.name || slot);
    }
  }
  return { counts, pieces };
}

/** 顯示用：回傳已裝備到的套裝進度（含每 tier 文字與是否達成）。 */
function getEquippedSetInfo(equipped = {}) {
  const { counts, pieces } = countEquippedSets(equipped);
  const out = [];
  for (const [key, count] of Object.entries(counts)) {
    const def = SET_DEFS[key];
    if (!def) continue;
    out.push({
      setKey: key,
      name: def.name,
      note: def.note || null,
      count,
      pieces: pieces[key] || [],
      tiers: def.tiers.map((t) => ({ count: t.count, desc: t.desc, active: count >= t.count })),
    });
  }
  return out;
}

/** combatStats 用：把達成 tier 的 numeric 加成合併成一個 bonuses 物件。 */
function getSetNumericBonuses(equipped = {}) {
  const b = {
    stats: { str: 0, int: 0, dex: 0 },
    hitPct: 0, dodgePct: 0, critRatePct: 0, critDamagePct: 0,
    damagePct: 0, finalDamagePct: 0, bossDamagePct: 0,
    goldPct: 0, expPct: 0, dropPct: 0,
  };
  const { counts } = countEquippedSets(equipped);
  for (const [key, count] of Object.entries(counts)) {
    const def = SET_DEFS[key];
    if (!def) continue;
    for (const t of def.tiers) {
      if (count < t.count || !t.numeric) continue;
      for (const [k, v] of Object.entries(t.numeric)) {
        if (k === "stats") { for (const s of ["str", "int", "dex"]) b.stats[s] += (v[s] || 0); }
        else if (k in b) b[k] += (v || 0);
      }
    }
  }
  return b;
}

/** 戰鬥用：回傳達成 tier 的 effect-engine 效果（帶 condition，交給引擎判定 zone 等）。 */
function getSetEffects(equipped = {}) {
  const effects = [];
  const { counts } = countEquippedSets(equipped);
  for (const [key, count] of Object.entries(counts)) {
    const def = SET_DEFS[key];
    if (!def) continue;
    for (const t of def.tiers) {
      if (count < t.count || typeof t.effects !== "function") continue;
      effects.push(...t.effects());
    }
  }
  return effects;
}

module.exports = {
  SET_SLOTS, SET_DEFS, EMPTY_NUMERIC,
  countEquippedSets, getEquippedSetInfo, getSetNumericBonuses, getSetEffects,
};
