"use strict";

const turn = value => ({ mode: "turns", value });
const effect = (key, target, params) => ({ key, target, trigger: "on_hit", chance: 100, sourcePhase: "proc", params });

const MONSTER_SKILLS = Object.freeze([
  null,
  {
    key: "mistwood_wisp_heal", name: "霧光回生", chance: 22, cooldownTurns: 2, trigger: "on_hit",
    description: "出手時有 22% 機率回復自身最大 HP 的 4%；發動後冷卻 2 回合。",
    procEffects: [effect("proc_heal", "self", { value: 4 })],
  },
  {
    key: "mistwood_tree_bark", name: "古樹護皮", chance: 20, cooldownTurns: 0, trigger: "on_hit",
    description: "出手時有 20% 機率使自身格擋率提高 18 個百分點，持續 2 回合，不可疊加。",
    procEffects: [effect("block_chance_up", "self", { value: 18, duration: turn(2), stackMode: "refresh" })],
  },
  {
    key: "mistwood_panther_shadowstep", name: "霧影疾行", chance: 28, cooldownTurns: 0, trigger: "on_hit",
    description: "出手時有 28% 機率使自身迴避率提高 10 個百分點，持續 2 回合，不可疊加。",
    procEffects: [effect("dodge_up", "self", { value: 10, duration: turn(2), stackMode: "refresh" })],
  },
  {
    key: "mistwood_wizard_mistbolt", name: "霧雷術", chance: 18, cooldownTurns: 2, trigger: "on_hit",
    description: "出手時有 18% 機率額外造成自身攻擊力 70% 的雷擊傷害；發動後冷卻 2 回合。",
    procEffects: [effect("lightning", "enemy", { value: 70, mode: "caster_atk_pct", duration: turn(1) })],
  },
  {
    key: "mistwood_raider_smoke", name: "迷煙奪視", chance: 25, cooldownTurns: 0, trigger: "on_hit",
    description: "出手時有 25% 機率使敵方命中率降低 12 個百分點，持續 2 回合，不可疊加。",
    procEffects: [effect("hit_down", "enemy", { value: 12, duration: turn(2), stackMode: "refresh" })],
  },
  {
    key: "mistwood_beast_charge", name: "巨角連撞", chance: 18, cooldownTurns: 3, trigger: "on_hit",
    description: "出手時有 18% 機率以自身攻擊力的 30% 連續追擊 2 次；發動後冷卻 3 回合。",
    procEffects: [effect("proc_chain_hit", "enemy", { chainCount: 2, damageMultiplier: 0.3 })],
  },
  {
    key: "mistwood_guardian_retribution", name: "森域反噬", chance: 22, cooldownTurns: 3, trigger: "on_hit",
    description: "出手時有 22% 機率獲得 12% 減傷與 18% 反擊機率，持續 2 回合；發動後冷卻 3 回合。",
    procEffects: [
      effect("damage_reduction", "self", { value: 12, duration: turn(2), stackMode: "refresh" }),
      effect("counter_attack", "self", { value: 18, duration: turn(2), stackMode: "refresh" }),
    ],
  },
]);

const { KEY } = require('../../src/shared/mistwoodCards');
const definitions = [
  ['wisp','霧魂儲能','承傷儲存20%，最多最大HP的8%；下一次成功攻擊消耗儲能並回復同量HP，每場最多2次。'],
  ['tree','三重年輪','每次實際承傷累積1層；3層後下一次承傷降低35%，觸發後2回合不再累積。'],
  ['panther','影後追獵','成功閃避後立即追加60%攻擊力反擊，冷卻2回合；不能爆擊、吸血或觸發連擊。'],
  ['wizard','霧雷共鳴','其他兩張卡片實際造成傷害後，有30%機率追加45%攻擊力雷擊；無冷卻，同次發動只判一次，不觸發自身。'],
  ['raider','竊取強化','普通攻擊命中有20%機率偷走普通怪物一項可解除的增益，持續2回合；同時最多1項，持有時不能再偷。BOSS與世界王完全無效，永久能力及特殊機制不能偷。轉移上限：攻擊、防禦、命中、爆擊率、爆傷、終傷、穿防10%，迴避5%、減傷8%、吸血3%。'],
  ['beast','四步重踏','每第4次成功普通攻擊追加45%攻擊力傷害；計數不跨場，技能、反擊、追擊不計數，不能爆擊、吸血或連鎖。'],
  ['guardian','森域淨界','每場取消首次可移除負面狀態，獲得最大HP8%的護盾，持續2回合；不可解除機制不適用。'],
];
const SKILLS = Object.freeze([null, ...definitions.map(([name, label, description], i) => ({
  key: KEY[name], name: label, description, trigger: 'battle_event', chance: 100, cooldownTurns: 0,
  procEffects: [], monsterSkill: structuredClone(MONSTER_SKILLS[i + 1]),
}))]);
function skillForMistwoodMonster(seq) {
  const skill = SKILLS[seq];
  if (!skill) throw new Error(`Unknown mistwood monster sequence: ${seq}`);
  return structuredClone(skill);
}
module.exports = { SKILLS, MONSTER_SKILLS, skillForMistwoodMonster };
