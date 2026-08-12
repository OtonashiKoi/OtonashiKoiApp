"use strict";

const TOWER_OWNER_TESTER_ID = "865264891991425055";

function getTowerTesterIds() {
  const extra = String(process.env.TOWER_TESTER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return new Set([TOWER_OWNER_TESTER_ID, ...extra]);
}

function isTowerTester(discordId) {
  return getTowerTesterIds().has(String(discordId || "").trim());
}

module.exports = { TOWER_OWNER_TESTER_ID, getTowerTesterIds, isTowerTester };
