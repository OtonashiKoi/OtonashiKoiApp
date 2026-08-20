"use strict";

const assert = require("assert");
const {
  _rankWorldBossChestContributors,
  _worldBossChestCountForRank,
  _worldBossSafeDisplayName,
} = require("../src/bot/handlers/monsterZoneHandlers");
const { buildWorldBossRankings } = require("../src/api/routes/playerAppRoutes");

const ranked = _rankWorldBossChestContributors([
  { pid: "support", damage: 700_000, assist: 100_000, cScore: 770_000 },
  { pid: "spender", damage: 500_000, assist: 0, cScore: 500_000, spent: 9_999_999 },
  { pid: "damage", damage: 800_000, assist: 0, cScore: 800_000, spent: 0 },
]);

assert.deepStrictEqual(
  ranked.map((entry) => entry.pid),
  ["damage", "support", "spender"],
  "入場費不得影響世界王寶箱貢獻排名"
);

const tieRanked = _rankWorldBossChestContributors([
  { pid: "assist", damage: 730_000, assist: 100_000, cScore: 800_000 },
  { pid: "damage", damage: 800_000, assist: 0, cScore: 800_000 },
]);
assert.deepStrictEqual(
  tieRanked.map((entry) => entry.pid),
  ["damage", "assist"],
  "貢獻同分時應先比較實際傷害"
);

assert.deepStrictEqual(
  [1, 2, 3, 4, 5, 6].map((rank) => _worldBossChestCountForRank(rank, 7)),
  [3, 3, 2, 1, 1, 1],
  "移除花費排名後不得改變七人場的寶箱數量"
);

const boards = buildWorldBossRankings({
  damage: { name: "純輸出", damage: 800_000, assist: 0 },
  support: { name: "輔助", damage: 700_000, assist: 200_000 },
  healer: { name: "純治療", damage: 0, assist: 100_000 },
});
assert.deepStrictEqual(
  boards.damageRanking.map((entry) => entry.name),
  ["純輸出", "輔助"],
  "世界王頁預設傷害排行只能依實際傷害排序"
);
assert.deepStrictEqual(
  boards.contributionRanking.map((entry) => entry.name),
  ["輔助", "純輸出", "純治療"],
  "世界王頁貢獻排行必須與寶箱公式一致，並納入純助攻玩家"
);

const participantBoards = buildWorldBossRankings({
  attacker: { name: "本輪參戰者", damage: 500_000, assist: 0 },
  staleAura: { name: "前一輪光環", damage: 0, assist: 900_000 },
}, ["attacker"]);
assert.deepStrictEqual(
  participantBoards.contributionRanking.map((entry) => entry.name),
  ["本輪參戰者"],
  "世界王貢獻榜不得讓未進入本輪戰鬥的跨場光環提供者取得名次"
);
assert.strictEqual(
  boards.contributionRanking[0].contribution,
  840_000,
  "貢獻值應為傷害＋0.7×助攻"
);
assert.strictEqual(
  _worldBossSafeDisplayName("386854676433207318", "386854676433207318"),
  "某位勇者",
  "世界王結算公告不得顯示完整 Discord ID"
);

console.log("✅ 世界王雙榜與寶箱排名：傷害榜只看傷害，貢獻榜為傷害＋0.7×助攻");
