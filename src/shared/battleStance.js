"use strict";
/**
 * 戰鬥姿態的請求驗證（聖劍士等帶 stances 的二轉職業用）。
 *
 * 規則（docs/JOB_T2_SWORDSMAN_HOLYBLADE.md）：
 *   - 沒裝有姿態系統的徽章 → 忽略玩家送來的 stance，回 null（完全走現況）
 *   - 未指定 → 預設攻擊姿態
 *   - 姿態要求帶盾但玩家沒帶 → **直接拒絕**（丟錯，不靜默退回）
 *   - 不認得的 stance 值 → 直接拒絕
 */
const { getStances } = require("./jobAdvancement");

const OFFHAND_WEAPON_TYPES = new Set(["offhand_sword", "offhand_dagger", "offhand_mace"]);

/** 玩家是不是真的帶著盾（副手是武器＝雙持，不算盾） */
function hasShieldEquipped(equipped) {
  const off = equipped?.shield;
  if (!off) return false;
  if (off.weaponType && OFFHAND_WEAPON_TYPES.has(String(off.weaponType))) return false;
  return String(off.equipSlot || "shield") === "shield";
}

/**
 * @param {object} equipped 玩家目前裝備
 * @param {string} requested 玩家送來的 stance
 * @returns {string|null} 要傳給 runCombatLoop 的 stance；null = 此職業沒有姿態系統
 * @throws {Error} 姿態不合法或條件不符（呼叫端轉成 400）
 */
function resolveRequestedStance(equipped, requested) {
  const stances = getStances(equipped?.job_eq);
  if (!stances) return null;                       // 沒有姿態系統 → 忽略

  const key = String(requested || "attack");
  const def = stances[key];
  if (!def) {
    const err = new Error(`未知的戰鬥姿態：${key}`);
    err.statusCode = 400;
    throw err;
  }
  if (def.requiresShield && !hasShieldEquipped(equipped)) {
    const err = new Error(`${def.label || key}姿態需要裝備盾牌`);
    err.statusCode = 400;
    throw err;
  }
  return key;
}

module.exports = { resolveRequestedStance, hasShieldEquipped };
