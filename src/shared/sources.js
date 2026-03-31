// 定義遊戲內金幣、經驗等來源常數與驗證工具
// ------------------------------------------

// 金幣來源類型
const CURRENCY_SOURCES = {
  DISCORD_TEST_REWARD: "discord:test-reward",      // 測試用：Discord 測試獎勵
  ADMIN_MANUAL_GRANT: "admin:manual-grant",         // 管理員手動發放
  ADMIN_MANUAL_DEDUCT: "admin:manual-deduct"        // 管理員手動扣除
};

// 經驗值來源類型
const EXP_SOURCES = {
  DISCORD_TEST_EXP: "discord:test-exp",             // 測試用：Discord 測試經驗
  ADMIN_MANUAL_GRANT_EXP: "admin:manual-grant-exp"  // 管理員手動發放經驗
};

// 驗證金幣來源是否合法
function isValidCurrencySource(source) {
  return Object.values(CURRENCY_SOURCES).includes(source);
}

// 驗證經驗來源是否合法
function isValidExpSource(source) {
  return Object.values(EXP_SOURCES).includes(source);
}

// 匯出常數與驗證工具
module.exports = {
  CURRENCY_SOURCES,
  EXP_SOURCES,
  isValidCurrencySource,
  isValidExpSource
};