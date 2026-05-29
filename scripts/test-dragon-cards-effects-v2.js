"use strict";
/**
 * 進階測試：對每張卡用「能觸發其效果的情境」跑戰鬥，
 * 並對每個 passive effect 個別檢查是否真的在 log 中出現對應訊息。
 *
 * 情境策略：
 *  - 一般卡 → 對 BOSS 跑 30 場
 *  - 暗影龍將卡（HP<30% 觸發） → 玩家起始 HP 25% 跑 30 場
 *  - 古龍王(B)卡（HP<30% last_stand） → 玩家起始 HP 25%
 *  - 火翼龍人卡（bonus_vs_burning） → 監控自身 burn buff 觸發
 *
 * 對每個 effect key 列舉預期 log 痕跡：
 *  combo_up        → "連擊"
 *  bonus_first_hit → 第一回合 DPR 高於後續
 *  reflect_damage  → "反彈" / "鏡映"
 *  counter_attack  → "反擊"
 *  on_hit_heal     → "回血" / "回復"
 *  life_regen      → "回復"
 *  on_kill_heal    → 勝利時 +HP
 *  post_battle_heal → 戰後 HP 高於戰中
 *  bonus_vs_boss   → DPR 顯著高（vs BOSS）
 *  bonus_vs_burning→ 自身有 burn buff，且對 burning 怪有 +damage
 *  bonus_vs_stunned→ 對 stunned 怪 +damage
 *  bonus_when_hp_high → HP > 70% 時 DPR 高
 *  bonus_when_hp_low  → HP < 30% 時 DPR 高
 *  bonus_reduction_when_hp_low → HP < 30% 時受傷少
 *  debuff_immunity → 玩家不出現 debuff
 *  control_immunity → 玩家不被 stun/freeze/silence
 *  execute_under_hp_pct → 出現 "斬殺" 或月怪被瞬殺
 *  shield (battle_start) → 第一場有 "護盾" log
 *  bonus_while_shielded → 有護盾時 DPR 更高
 *  stack_on_hit_offense → 後期回合 ATK 增加，DPR 後高前低
 *  stack_on_taken_defense → 後期回合 DEF 增加
 *  physical/magic_damage_reduction → 玩家受傷少
 *  last_stand → HP<30% 時 DPR 提升
 *  crit_rate_up / crit_damage_up → 暴擊次數增加
 *  combo_damage_up → 連擊傷害增加
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");

const RUNS = 30;
const MAX_ROUNDS = 15;

// effect → 預期 log 關鍵字 / 評估方式
const EFFECT_ASSERTIONS = {
  combo_up:        { check: "log_keyword", patterns: [/連擊/] },
  bonus_first_hit: { check: "dpr_boost", minBoost: 0 },
  reflect_damage:  { check: "log_keyword", patterns: [/反彈|鏡映/] },
  counter_attack:  { check: "log_keyword", patterns: [/反擊/] },
  on_hit_heal:     { check: "log_keyword", patterns: [/回血|回復|HP）/] },
  life_regen:      { check: "log_keyword", patterns: [/回復/] },
  on_kill_heal:    { check: "log_keyword", patterns: [/擊殺|回復/] },
  post_battle_heal:{ check: "log_keyword", patterns: [/戰鬥|回復/] },
  bonus_vs_boss:   { check: "dpr_boost", minBoost: 20 },
  bonus_vs_burning:{ check: "log_keyword", patterns: [/燃燒/] },
  bonus_vs_stunned:{ check: "log_keyword", patterns: [/暈眩|擊暈/] },
  bonus_when_hp_high: { check: "dpr_boost", minBoost: 5 },
  bonus_when_hp_low:  { check: "dpr_boost_low_hp", minBoost: 10 },
  bonus_reduction_when_hp_low: { check: "low_hp_survival" },
  debuff_immunity: { check: "stats_check", note: "玩家不出現 debuff（情境依賴）" },
  control_immunity:{ check: "stats_check", note: "免疫 stun/freeze/silence" },
  execute_under_hp_pct: { check: "log_keyword", patterns: [/斬殺|處決/] },
  shield:          { check: "log_keyword", patterns: [/護盾|盾/] },
  bonus_while_shielded: { check: "log_keyword", patterns: [/盾/] },
  stack_on_hit_offense: { check: "log_keyword", patterns: [/疊加|戰意|攻勢/] },
  stack_on_taken_defense: { check: "log_keyword", patterns: [/疊加|戰意|防禦/] },
  physical_damage_reduction: { check: "less_damage_taken" },
  magic_damage_reduction: { check: "less_damage_taken" },
  last_stand: { check: "dpr_boost_low_hp", minBoost: 5 },
  crit_rate_up: { check: "stats_check", note: "crit 提升" },
  crit_damage_up: { check: "stats_check", note: "critDamage 提升" },
  combo_damage_up: { check: "stats_check", note: "comboDamageMultiplier 提升" },
};

const CARD_SCENARIOS = {
  "飛龍幼崽卡": { startHpPct: 100 },
  "龍蜥武士卡": { startHpPct: 100 },
  "火翼龍人卡": { startHpPct: 100 },
  "冰鱗龍人卡": { startHpPct: 100 },
  "雷霆飛龍卡": { startHpPct: 100 },
  "黑曜龍騎卡": { startHpPct: 100 },
  "黃金幼龍(稀)卡": { startHpPct: 50 }, // 讓 life_regen / on_hit_heal 看得出來
  "暗影龍將卡": { startHpPct: 25 },     // 觸發 bonus_when_hp_low
  "龍翼魔法師卡": { startHpPct: 100 },
  "古龍王(B)卡": { startHpPct: 25 },    // 觸發 last_stand
};

function buildMonsterCalc(m) {
  const level = Math.max(1, m.level || 1);
  const intStat = m.int || 0;
  const vit = m.vit || 0;
  return {
    maxHp: m.maxHp || (level * 800 + vit * 200),
    atk: (m.str || 1) * 3,
    def: Math.min(75, Math.max(0, Number(m.def) || 0)),
    flatDef: (typeof m.flatDef === "number") ? Math.max(0, m.flatDef) : level + vit,
    level, agi: m.agi || 1, int: intStat, dex: m.dex || 1, luk: m.luk || 0,
    dodge: Math.min(50, (m.agi || 1) * 0.5),
    hit: Math.min(100, 80 + (m.dex || 1)),
    critRate: Math.min(100, Math.round((m.luk || 0) * 0.3)),
    comboChance: Math.min(80, Math.round(3 + (m.agi || 1) * 0.5)),
    defIgnorePct: m.defIgnorePct || 0,
    isBoss: Boolean(m.isBoss),
    dmgMin: Math.min(1.0, 0.7 + intStat * 0.01),
    dmgMax: 1.0,
  };
}

function runScenario(playerProgress, monster, card, opts = {}) {
  const baseEquipped = { ...(playerProgress.equipment || {}) };
  const eq = { ...baseEquipped, special_1: card, special_2: null, special_3: null };
  const ps = calcPlayerStats(playerProgress.attributes || {}, eq, [], playerProgress.inventory || [], { pkRating: null });
  const mCalc = buildMonsterCalc(monster);
  const startHp = Math.max(1, Math.round(ps.maxHp * ((opts.startHpPct ?? 100) / 100)));

  let totalDmg = 0, totalRounds = 0, totalDmgTaken = 0, deaths = 0;
  const allLogs = [];

  for (let i = 0; i < RUNS; i++) {
    const r = runCombatLoop(ps, mCalc, monster.name, mCalc.maxHp, MAX_ROUNDS, {
      playerLevel: playerProgress.level,
      equipped: eq,
      inventory: playerProgress.inventory || [],
      monsterIsBoss: !!monster.isBoss,
      startPlayerHp: startHp,
    });
    if (r.outcome === "lose") deaths++;
    totalDmg += r.totalDamage || 0;
    totalRounds += r.roundLogs?.length || 0;
    totalDmgTaken += Math.max(0, startHp - (r.finalPlayerHp ?? startHp));
    if (i < 5) allLogs.push(...(r.roundLogs || []));
  }
  return { ps, totalDmg, totalRounds, totalDmgTaken, deaths, allLogs };
}

function checkEffect(effectKey, result, baseResult, baseStats) {
  const cfg = EFFECT_ASSERTIONS[effectKey];
  if (!cfg) return { pass: null, note: "no assertion" };

  if (cfg.check === "log_keyword") {
    const allText = result.allLogs.join("\n");
    const matched = cfg.patterns.find(p => p.test(allText));
    return { pass: !!matched, note: matched ? `命中 ${matched}` : `沒看到 ${cfg.patterns.map(p=>p.source).join("/")}` };
  }
  if (cfg.check === "dpr_boost") {
    const baseDpr = baseResult.totalDmg / Math.max(1, baseResult.totalRounds);
    const dpr = result.totalDmg / Math.max(1, result.totalRounds);
    const boost = ((dpr - baseDpr) / baseDpr) * 100;
    return { pass: boost >= (cfg.minBoost || 0), note: `DPR ${baseDpr.toFixed(0)}→${dpr.toFixed(0)} (+${boost.toFixed(0)}%)` };
  }
  if (cfg.check === "dpr_boost_low_hp") {
    const baseDpr = baseResult.totalDmg / Math.max(1, baseResult.totalRounds);
    const dpr = result.totalDmg / Math.max(1, result.totalRounds);
    const boost = ((dpr - baseDpr) / baseDpr) * 100;
    return { pass: boost >= (cfg.minBoost || 0), note: `低血 DPR ${baseDpr.toFixed(0)}→${dpr.toFixed(0)} (+${boost.toFixed(0)}%)` };
  }
  if (cfg.check === "low_hp_survival") {
    const dr = result.totalDmgTaken / RUNS;
    const baseDr = baseResult.totalDmgTaken / RUNS;
    return { pass: dr < baseDr, note: `受傷/場 ${baseDr.toFixed(0)}→${dr.toFixed(0)}` };
  }
  if (cfg.check === "less_damage_taken") {
    const dr = result.totalDmgTaken / RUNS;
    const baseDr = baseResult.totalDmgTaken / RUNS;
    return { pass: dr < baseDr * 0.95, note: `受傷/場 ${baseDr.toFixed(0)}→${dr.toFixed(0)}` };
  }
  if (cfg.check === "stats_check") {
    return { pass: null, note: cfg.note || "需手動驗證" };
  }
  return { pass: null, note: "?" };
}

async function main() {
  const db = await getMongoDb();
  const cands = await db.collection("progress").find({ level: 40 }).limit(100).toArray();
  let testPlayer = null;
  for (const p of cands) {
    const eq = p.equipment || {};
    const count = ["weapon","shield","armor","garment","shoes","head_top","head_mid","head_low","accessory_l","accessory_r","job_eq"].filter(s => eq[s]).length;
    if (count >= 10) { testPlayer = p; break; }
  }
  if (!testPlayer) { console.error("no suitable Lv.40 player"); process.exit(1); }

  const dragonKing = await db.collection("monsters").findOne({ name: "古龍王(B)" });
  console.log(`測試玩家：${testPlayer.playerId} Lv.${testPlayer.level}`);
  console.log(`測試對手：${dragonKing.name} Lv.${dragonKing.level} HP=${dragonKing.maxHp}\n`);

  const baseEq = { ...(testPlayer.equipment || {}), special_1: null, special_2: null, special_3: null };
  const baseStats = calcPlayerStats(testPlayer.attributes || {}, baseEq, [], testPlayer.inventory || [], { pkRating: null });

  // 跑兩個基準：滿血 & 25% HP
  const baseFull = runScenario({ ...testPlayer, equipment: baseEq }, dragonKing, null, { startHpPct: 100 });
  const baseLow  = runScenario({ ...testPlayer, equipment: baseEq }, dragonKing, null, { startHpPct: 25 });
  console.log(`基準（無卡，滿血）：DPR=${(baseFull.totalDmg/baseFull.totalRounds).toFixed(1)} 受傷/場=${(baseFull.totalDmgTaken/RUNS).toFixed(0)} 陣亡=${baseFull.deaths}`);
  console.log(`基準（無卡，HP25%）：DPR=${(baseLow.totalDmg/baseLow.totalRounds).toFixed(1)} 受傷/場=${(baseLow.totalDmgTaken/RUNS).toFixed(0)} 陣亡=${baseLow.deaths}`);
  console.log("═".repeat(110));

  const names = Object.keys(CARD_SCENARIOS);
  for (const name of names) {
    const cardDoc = await db.collection("items").findOne({ name, equipSlot: "special" });
    if (!cardDoc) { console.log(`✗ ${name}`); continue; }
    const cardEntry = {
      uuid: "test", itemId: cardDoc.id, itemName: cardDoc.name,
      itemType: cardDoc.itemType, equipSlot: cardDoc.equipSlot, tier: cardDoc.tier,
      equipStats: cardDoc.equipStats || { str:0,agi:0,vit:0,int:0,dex:0,luk:0 },
      passiveEffects: cardDoc.passiveEffects || [],
      procEffects: cardDoc.procEffects || [], combatEffects: cardDoc.combatEffects || [],
      useEffects: cardDoc.useEffects || [],
      monsterCardSkill: cardDoc.monsterCardSkill || null,
    };
    const scenario = CARD_SCENARIOS[name];
    const baseline = scenario.startHpPct < 50 ? baseLow : baseFull;
    const run = runScenario(testPlayer, dragonKing, cardEntry, scenario);

    const dpr = run.totalDmg / Math.max(1, run.totalRounds);
    console.log(`\n■ ${name}  (情境：起始 HP=${scenario.startHpPct}%)`);
    console.log(`   DPR=${dpr.toFixed(1)}  受傷/場=${(run.totalDmgTaken/RUNS).toFixed(0)}  陣亡=${run.deaths}`);
    console.log(`   stats vs base: ATK ${baseStats.atk}→${run.ps.atk} HP ${baseStats.maxHp}→${run.ps.maxHp} crit ${baseStats.crit.toFixed(1)}→${run.ps.crit.toFixed(1)} combo ${baseStats.combo.toFixed(1)}→${run.ps.combo.toFixed(1)} comboDmgMul ${baseStats.comboDamageMultiplier.toFixed(2)}→${run.ps.comboDamageMultiplier.toFixed(2)}`);
    const passives = cardDoc.passiveEffects || [];
    if (passives.length === 0) { console.log(`   (無 passive)`); continue; }
    for (const ef of passives) {
      const r = checkEffect(ef.key, run, baseline, baseStats);
      const mark = r.pass === true ? "✅" : r.pass === false ? "❌" : "  ";
      console.log(`   ${mark} ${ef.key.padEnd(28)} value=${ef.params?.value ?? "?"}  → ${r.note}`);
    }
  }
  console.log("═".repeat(110));
}

main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
