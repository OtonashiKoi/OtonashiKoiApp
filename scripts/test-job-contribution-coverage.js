#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { runCombatLoop } = require("../src/shared/combatLoop");
const {
  CONTROL_WINDOW_ASSIST_PCT,
  SUPPORT_EFFECT_KINDS,
  supportEffectKind,
  directDamageAssistPot,
  allocateDirectDamage,
  mirrorDamageToOtherParts,
  defenseOffenseAssistPot,
  mergeContributorMaps,
} = require("../src/shared/supportContribution");

const PLAYER = {
  maxHp: 2000, atk: 300, def: 10, flatDef: 0,
  str: 30, agi: 20, vit: 20, int: 20, dex: 100, luk: 10,
  hit: 100, dodge: 0, crit: 0, combo: 0,
  comboDamageMultiplier: 1, dmgMin: 1, dmgMax: 1,
  weaponType: "sword_1h", finalDamageMultiplier: 1,
  bypassMonsterDefPct: 0,
};

const MONSTER = {
  maxHp: 999999, atk: 250, def: 40, flatDef: 0,
  str: 1, agi: 20, vit: 1, int: 1, dex: 100, luk: 1,
  hit: 100, dodge: 0, critRate: 0, critDamage: 1.5,
  monsterAttackCount: 1,
};

function effect(key, value, sourceDiscordId, sourceJobId, sourceJobName, extraParams = {}) {
  return {
    key,
    target: "party",
    trigger: "passive",
    params: { value, ...extraParams },
    sourceDiscordId,
    sourceJobId,
    sourceJobName,
    sourceName: sourceDiscordId,
    isSelfAura: false,
  };
}

function battle(partyEffects = [], options = {}) {
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    return runCombatLoop(
      { ...PLAYER },
      { ...MONSTER },
      "貢獻測試木樁",
      MONSTER.maxHp,
      5,
      { partyEffects, monsterIsBoss: true, ...options }
    );
  } finally {
    Math.random = originalRandom;
  }
}

assert.strictEqual(CONTROL_WINDOW_ASSIST_PCT, 10, "控制窗口助攻池應固定為受益玩家有效輸出的 10%");
for (const key of Object.keys(SUPPORT_EFFECT_KINDS)) {
  assert(supportEffectKind(key), `支援效果 ${key} 必須有分類`);
}
assert.strictEqual(supportEffectKind("unknown_effect"), null, "未知效果不得靜默冒充已支援貢獻");
assert.strictEqual(Math.round(directDamageAssistPot(1100, 10)), 100, "10% 增傷應反推為 100 原始傷害當量");
assert.deepStrictEqual(
  allocateDirectDamage(500, 1000, { sniper: 200 }),
  { selfDamage: 400, bySource: { sniper: 100 }, sourceTotal: 100 },
  "王只剩一半血時，出戰者與神射手直接傷害都必須等比例縮放"
);
assert.deepStrictEqual(
  mirrorDamageToOtherParts({ head: 100, body: 80, wings: 0 }, "head", 50),
  { partsHp: { head: 100, body: 30, wings: 0 }, total: 50 },
  "元素師炎圈只能鏡射其他仍存活部位，且不得扣成負數"
);
assert(defenseOffenseAssistPot({ totalDamage: 1000, monsterDefPct: 40, partyDefDownPct: 10 }) > 0,
  "怪物有防禦時，兵聖破防必須產生正助攻當量");

const spiritDamageOnly = battle([
  effect("party_damage_up", 5, "spiritmaster", "job_spiritmaster_t2_v1", "聖靈師"),
]);
assert(spiritDamageOnly.assistLedger.bySource.spiritmaster > 0, "聖靈師 5% 隊伍增傷必須計入 A");
assert.strictEqual(
  spiritDamageOnly.assistLedger.bySourceJob.spiritmaster.job_spiritmaster_t2_v1.amount,
  spiritDamageOnly.assistLedger.bySource.spiritmaster,
  "聖靈師助攻必須歸在出招時的職業，不可只混進玩家總數"
);

const spiritDamageAndHeal = battle([
  effect("party_damage_up", 5, "spiritmaster", "job_spiritmaster_t2_v1", "聖靈師"),
  effect("heal_over_time", 3, "spiritmaster", "job_spiritmaster_t2_v1", "聖靈師", { mode: "pct" }),
]);
assert(
  spiritDamageAndHeal.assistLedger.bySource.spiritmaster > spiritDamageOnly.assistLedger.bySource.spiritmaster,
  "聖靈師除隊伍增傷外，實際有效治療也必須另計 A"
);

const sageBossOnly = battle([
  effect("party_boss_damage_up", 10, "sage", "job_sage_t2_v1", "兵聖"),
]);
const sageFull = battle([
  effect("party_boss_damage_up", 10, "sage", "job_sage_t2_v1", "兵聖"),
  effect("party_monster_def_down", 10, "sage", "job_sage_t2_v1", "兵聖"),
]);
assert(
  sageFull.assistLedger.bySource.sage > sageBossOnly.assistLedger.bySource.sage,
  "兵聖的怪物防禦降低必須在 Boss 增傷之外另計實際防禦收益"
);

const mitigation = battle([
  effect("party_damage_reduction", 15, "sanctum-aura", "job_sanctum_t2_v1", "聖域師"),
  effect("party_crit_damage_reduction", 10, "sanctum-aura", "job_sanctum_t2_v1", "聖域師"),
]);
assert(mitigation.assistLedger.bySource["sanctum-aura"] > 0, "隊伍減傷必須按實際擋下傷害計 A");

const bard = battle([
  effect("party_agi_up", 8, "minstrel", "job_minstrel_t2_v1", "吟遊詩人"),
]);
assert(bard.assistLedger.bySource.minstrel > 0, "吟遊詩人 AGI 光環必須計 A");

const controlContributors = mergeContributorMaps(
  { dwarf: { amount: 2, jobId: "job_dwarflord_t2_v1", jobName: "矮人戰士長" } },
  { elementalist: { amount: 1, jobId: "job_elementalist_t2_v1", jobName: "元素師" } }
);
const controlled = battle([], { teamStunRounds: 999, teamControlContributors: controlContributors });
assert(controlled.assistLedger.stunSkippedRounds > 0, "控制窗口必須真的略過怪物行動");
assert.strictEqual(controlled.assistLedger.stunPreventedDmg, 0, "舊暈眩欄位必須歸零，避免呼叫端重複計分");
assert.strictEqual(
  controlled.assistLedger.bySource.dwarf + controlled.assistLedger.bySource.elementalist,
  Math.round(controlled.totalDamage * CONTROL_WINDOW_ASSIST_PCT / 100),
  "矮人／元素控制窗口的總 A 應等於受益玩家有效輸出的 10%"
);
assert.strictEqual(
  controlled.assistLedger.bySource.dwarf,
  controlled.assistLedger.bySource.elementalist * 2,
  "多人敲控制條時必須按實際敲條量分帳"
);

const sanctuary = battle([], {
  sanctuaryCutPct: 50,
  sanctuaryHealPct: 3,
  sanctuaryContributors: {
    sanctum: { amount: 1, jobId: "job_sanctum_t2_v1", jobName: "聖域師" },
  },
});
assert(sanctuary.assistLedger.sanctuaryPreventedDmg > 0, "聖域窗口必須量測實際減傷");
assert(sanctuary.assistLedger.sanctuaryHealDone > 0, "聖域窗口必須量測實際治療");
assert.strictEqual(
  sanctuary.assistLedger.bySource.sanctum,
  sanctuary.assistLedger.sanctuaryPreventedDmg + sanctuary.assistLedger.sanctuaryHealDone,
  "聖域師 A 應等於窗口實際擋傷＋有效治療"
);

const selfAura = battle([{
  ...effect("party_damage_up", 99, "self", "job_spiritmaster_t2_v1", "聖靈師"),
  isSelfAura: true,
}]);
assert.deepStrictEqual(selfAura.assistLedger.bySource, {}, "自己的光環不可替自己灌 A");

const noSupport = battle([]);
assert.deepStrictEqual(noSupport.assistLedger.bySource, {}, "沒有團隊能力的純輸出職業不得憑空得到 A");

console.log("✅ 全職業貢獻公式測試通過：增傷、治療、破防、減傷、AGI、控制窗口、聖域與不可自益");
