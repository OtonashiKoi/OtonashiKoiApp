/**
 * 裝備強化配置表
 * 定義各階級裝備的強化規則
 */

// 強化寶石 ID 對應
const ENHANCE_GEMS = {
  D: '72fde92d-e33f-42fb-8d86-2e811d03f84d',
  C: '556db9e1-b084-4b22-bab5-a66c2b586184',
  B: '8fdfa7d9-f0fa-4e6a-a291-703b1e354072',
  A: 'a6ae293d-52fc-4af5-8770-891ddf842e35',
  S: 'gem-s-tier'
};

/**
 * 強化規則配置
 * tier: { +1: { gems: 消耗寶石數, success: 成功率% }, ... }
 */
// V0.4 重調：石數 2/5/8/12/25、成功率 100/85/70/30/10%。
// +1~+3 便宜好推（軟上限 +3），+4/+5 大幅拉低成功率成為長線追求（+5 期望約 309 顆）。
// 全品階同表；S 的稀缺改由「S 石只從世界王掉」把關，不再另壓成功率。
const ENHANCE_STEPS = {
  '+1': { gems: 2, success: 100 },
  '+2': { gems: 5, success: 85 },
  '+3': { gems: 8, success: 70 },
  '+4': { gems: 12, success: 30 },
  '+5': { gems: 25, success: 10 }
};
const ENHANCE_RULES = {
  D: { ...ENHANCE_STEPS },
  C: { ...ENHANCE_STEPS },
  B: { ...ENHANCE_STEPS },
  A: { ...ENHANCE_STEPS },
  S: { ...ENHANCE_STEPS }
};

const ENHANCE_GOLD_COST = {
  D: {
    "+1": 0,
    "+2": 500,
    "+3": 2000,
    "+4": 6000,
    "+5": 12000
  },
  C: {
    "+1": 500,
    "+2": 1500,
    "+3": 4000,
    "+4": 12000,
    "+5": 25000
  },
  B: {
    "+1": 1000,
    "+2": 3000,
    "+3": 8000,
    "+4": 25000,
    "+5": 50000
  },
  A: {
    "+1": 2000,
    "+2": 6000,
    "+3": 15000,
    "+4": 50000,
    "+5": 100000
  },
  S: {
    "+1": 5000,
    "+2": 15000,
    "+3": 40000,
    "+4": 100000,
    "+5": 200000
  }
};

/**
 * 各等級最大強化等級
 */
const MAX_ENHANCE_LEVEL = 5;

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
 * 獲取強化所需的金幣數量
 * @param {string} tier 裝備品階 (D/C/B/A)
 * @param {number} currentLevel 目前強化等級
 * @returns {number} 強化到下一等級所需金幣，如果已達上限返回 -1
 */
function getGoldRequired(tier, currentLevel = 0) {
  const tierConfig = ENHANCE_GOLD_COST[tier?.toUpperCase()];
  if (!tierConfig) return null;

  const nextLevel = currentLevel + 1;
  const key = `+${nextLevel}`;

  if (nextLevel > MAX_ENHANCE_LEVEL) return -1;
  return Number.isFinite(tierConfig[key]) ? tierConfig[key] : null;
}

function getEnhanceCost(tier, currentLevel = 0) {
  const gemsRequired = getGemsRequired(tier, currentLevel);
  const goldRequired = getGoldRequired(tier, currentLevel);
  const successRate = getSuccessRate(tier, currentLevel);
  return { gemsRequired, goldRequired, successRate };
}

/**
 * 檢驗是否可強化
 * @returns {object} { canEnhance: boolean, reason: string }
 */
function validateEnhance(tier, currentLevel, gemsOwned, goldOwned = Number.POSITIVE_INFINITY) {
  tier = String(tier || '').toUpperCase();
  currentLevel = Math.max(0, Number(currentLevel) || 0);
  gemsOwned = Math.max(0, Number(gemsOwned) || 0);
  goldOwned = Math.max(0, Number(goldOwned) || 0);

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

  const goldRequired = getGoldRequired(tier, currentLevel);
  if (goldOwned < goldRequired) {
    return { canEnhance: false, reason: `金幣不足，需要 ${goldRequired} 金幣，目前擁有 ${goldOwned} 金幣` };
  }

  return { canEnhance: true, reason: null };
}

module.exports = {
  ENHANCE_GEMS,
  ENHANCE_GOLD_COST,
  ENHANCE_RULES,
  MAX_ENHANCE_LEVEL,
  getGemsRequired,
  getSuccessRate,
  getGoldRequired,
  getEnhanceCost,
  validateEnhance
};
