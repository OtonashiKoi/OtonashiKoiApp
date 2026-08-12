"use strict";

// 多角色系統封閉測試名單。預設只開放音無恋；正式開放前可用環境變數加測試者，
// 不以暱稱判斷，避免同名玩家取得權限。
const CHARACTER_OWNER_TESTER_ID = "865264891991425055";

function getCharacterTesterIds() {
  const extra = String(process.env.CHARACTER_TESTER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return new Set([CHARACTER_OWNER_TESTER_ID, ...extra]);
}

function isCharacterTester(discordId) {
  return getCharacterTesterIds().has(String(discordId || "").trim());
}

module.exports = {
  CHARACTER_OWNER_TESTER_ID,
  getCharacterTesterIds,
  isCharacterTester,
};
