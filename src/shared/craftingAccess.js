"use strict";

// 合成系統封閉測試名單。預設只開放音無恋；需要增加測試者時可用環境變數附加，
// 不以 displayName 判斷，避免同名玩家取得測試權限。
const OWNER_TESTER_ID = "865264891991425055";
const configuredIds = String(process.env.CRAFTING_TESTER_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const CRAFTING_TESTER_IDS = new Set([OWNER_TESTER_ID, ...configuredIds]);

function isCraftingTester(discordId) {
  return CRAFTING_TESTER_IDS.has(String(discordId || "").trim());
}

module.exports = {
  OWNER_TESTER_ID,
  CRAFTING_TESTER_IDS,
  isCraftingTester
};
