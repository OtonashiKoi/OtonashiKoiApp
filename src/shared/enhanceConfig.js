/**
 * 裝備強化配置表
 * 定義各階級裝備的強化規則
 */

// 強化寶石 ID 對應
const ENHANCE_GEMS = {
  D: '72fde92d-e33f-42fb-8d86-2e811d03f84d',
  C: '556db9e1-b084-4b22-bab5-a66c2b586184',
  B: '8fdfa7d9-f0fa-4e6a-a291-703b1e354072',
  A: 'a6ae293d-52fc-4af5-8770-891ddf842e35'
};

/**
 * 強化規則配置
 * tier: { +1: { gems: 消耗寶石數, success: 成功率% }, ... }
 */
const ENHANCE_RULES = {
  D: {
    '+1': { gems: 2, success: 100 },
    '+2': { gems: 5, success: 80 },
    '+3': { gems: 15, success: 60 }
  },
  C: {
    '+1': { gems: 2, success: 100 },
    '+2': { gems: 5, success: 80 },
    '+3': { gems: 15, success: 60 }
  },
  B: {
    '+1': { gems: 2, success: 100 },
    '+2': { gems: 5, success: 80 },
    '+3': { gems: 15, success: 60 }
  },
  A: {
    '+1': { gems: 2, success: 100 },
    '+2': { gems: 5, success: 80 },
    '+3': { gems: 15, success: 60 }
  }
};

/**
 * 各等級最大強化等級
 */
const MAX_ENHANCE_LEVEL = 3;

/**
 * 獲取強化所需的寶石數量
 * @param {string} tier 裝備品階 (D/C/B/A)
 * @param {number} currentLevel 目前強化等級
 * @returns {number} 強化到下一等級所需寶石數，如果已達上限返回 -1
 */
function getGemsRequired(tier, currentLevel = 0) {
  const tierConfig = ENHANCE_RULES[tier?.toUpperCase()];
  if (!tierConfig) return null;

  const nextLevel = currentLevel + 1;
  const key = `+${nextLevel}`;

  if (nextLevel > MAX_ENHANCE_LEVEL) return -1; // 已達上限

  const rule = tierConfig[key];
  return rule ? rule.gems : null;
}

/**
 * 獲取強化成功率
 * @param {string} tier 裝備品階 (D/C/B/A)
 * @param {number} currentLevel 目前強化等級
 * @returns {number} 成功率百分比，如果已達上限返回 -1
 */
function getSuccessRate(tier, currentLevel = 0) {
  const tierConfig = ENHANCE_RULES[tier?.toUpperCase()];
  if (!tierConfig) return null;

  const nextLevel = currentLevel + 1;
  const key = `+${nextLevel}`;

  if (nextLevel > MAX_ENHANCE_LEVEL) return -1; // 已達上限

  const rule = tierConfig[key];
  return rule ? rule.success : null;
}

/**
 * 檢驗是否可強化
 * @returns {object} { canEnhance: boolean, reason: string }
 */
function validateEnhance(tier, currentLevel, gemsOwned) {
  tier = String(tier || '').toUpperCase();
  currentLevel = Math.max(0, Number(currentLevel) || 0);
  gemsOwned = Math.max(0, Number(gemsOwned) || 0);

  // 檢查品階是否有效
  if (!ENHANCE_RULES[tier]) {
    return { canEnhance: false, reason: `無效的品階: ${tier}` };
  }

  // 檢查是否已達上限
  if (currentLevel >= MAX_ENHANCE_LEVEL) {
    return { canEnhance: false, reason: `已達最大強化等級 +${MAX_ENHANCE_LEVEL}` };
  }

  // 檢查寶石數量
  const gemsRequired = getGemsRequired(tier, currentLevel);
  if (gemsOwned < gemsRequired) {
    return { canEnhance: false, reason: `寶石不足，需要 ${gemsRequired} 顆，目前擁有 ${gemsOwned} 顆` };
  }

  return { canEnhance: true, reason: null };
}

module.exports = {
  ENHANCE_GEMS,
  ENHANCE_RULES,
  MAX_ENHANCE_LEVEL,
  getGemsRequired,
  getSuccessRate,
  validateEnhance
};
