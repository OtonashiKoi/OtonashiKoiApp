"use strict";
/**
 * 怪物圖鑑（Bestiary）核心。
 * 機制：對每隻怪累積「有效擊殺數」= Σ(每場對該怪造成的傷害 / 該怪最大HP)。
 *   一場打到該怪 10% 血 → +0.1 隻；100% → +1 隻；可累積。
 * 依累積隻數提升「對該怪傷害」，達需求數時固定 +15%，中間線性：
 *   bonus% = min(15, 15 × 累積隻數 / 需求數)
 *   （2026-08-04 下季平衡：25% → 15%）
 * 需求數依怪物種類：一般 100、BOSS 50、世界王 10。
 */

const MAX_BONUS_PCT = 15;   // 2026-08-04：25 → 15
const REQ_NORMAL = 100;
const REQ_BOSS = 50;
const REQ_WORLD_BOSS = 10;

// 怪物種類 → 需求隻數。isWorldBoss 由呼叫端(知道 zone)傳入,避免循環依賴。
function bestiaryRequirement(monster, isWorldBoss = false) {
  if (isWorldBoss) return REQ_WORLD_BOSS;
  if (monster && monster.isBoss) return REQ_BOSS;
  return REQ_NORMAL;
}

// 依累積隻數算對該怪的傷害加成%（0 ~ 25，線性，達需求即封頂 25）
function bestiaryBonusPct(effectiveKills, requirement) {
  const k = Math.max(0, Number(effectiveKills) || 0);
  const req = Math.max(1, Number(requirement) || 1);
  return Math.min(MAX_BONUS_PCT, (MAX_BONUS_PCT * k) / req);
}

// 一場戰鬥對某怪的「有效擊殺」增量 = min(1, 本場傷害 / 該怪最大HP)。回傳 0~1。
function bestiaryGainFromDamage(damageDealt, monsterMaxHp) {
  const dmg = Math.max(0, Number(damageDealt) || 0);
  const maxHp = Math.max(1, Number(monsterMaxHp) || 1);
  return Math.min(1, dmg / maxHp);
}

module.exports = {
  MAX_BONUS_PCT,
  REQ_NORMAL,
  REQ_BOSS,
  REQ_WORLD_BOSS,
  bestiaryRequirement,
  bestiaryBonusPct,
  bestiaryGainFromDamage,
};
