// 定義遊戲內金幣、經驗等來源常數與驗證工具
// ------------------------------------------

// 金幣來源類型
const CURRENCY_SOURCES = {
  DISCORD_TEST_REWARD: "discord:test-reward",      // 測試用：Discord 測試獎勵
  ADMIN_MANUAL_GRANT: "admin:manual-grant",         // 管理員手動發放
  ADMIN_MANUAL_DEDUCT: "admin:manual-deduct",       // 管理員手動扣除
  SHOP_PURCHASE: "shop:purchase",                   // 金幣商店購買
  ITEM_USE: "item:use",                             // 使用道具效果
  MONSTER_ENTRY_FEE: "monster:entry-fee",           // 放怪區：入場費扣除
  MONSTER_KILL_REWARD: "monster:kill-reward",       // 放怪區：擊殺金幣獎勵
  ITEM_SELL: "item:sell"                             // 玩家販售道具
};

// 經驗值來源類型
const EXP_SOURCES = {
  DISCORD_TEST_EXP: "discord:test-exp",             // 測試用：Discord 測試經驗
  ADMIN_MANUAL_GRANT_EXP: "admin:manual-grant-exp", // 管理員手動發放經驗
  ITEM_USE_EXP: "item:use-exp",                     // 使用道具效果
  MONSTER_KILL: "monster:kill"                      // 放怪區：擊殺 EXP 獎勵
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