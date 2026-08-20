"use strict";

/**
 * 2026-08-19 島島龜王全破未結算事故補償。
 *
 * 依據：16:16:00–16:29:10（Asia/Taipei）內 3,000 金幣的正式入場費交易。
 * 舊入場費交易沒有寫 zone sourceRef，因此另以事故時間、費用、玩家與筆數護欄交叉確認。
 * 補償：
 *   1. 每位玩家退還該窗口內全部入場費。
 *   2. 每位有入場費證據的玩家補 1 個島島龜王寶箱（所有合法參戰者的保底份數）。
 *
 * 排名傷害已被舊自癒流程清除，因此不推測前 1–3 名額外箱數。
 * 金幣以 (source, sourceRef) 去重；寶箱與 compensationRefs 在同一次原子更新中寫入。
 *
 * 用法：
 *   node scripts/compensate-turtle-stuck-20260819.js
 *   node scripts/compensate-turtle-stuck-20260819.js --yes
 */
require("dotenv").config();
const crypto = require("node:crypto");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { createRepositories } = require("../src/repositories/createRepositories");
const { PlayerService } = require("../src/services/player/playerService");
const { RewardService } = require("../src/services/reward/rewardService");
const { CURRENCY_SOURCES } = require("../src/shared/sources");
const { slimInventoryEntry } = require("../src/shared/inventoryStorage");

const APPLY = process.argv.includes("--yes") || process.argv.includes("-y");
const INCIDENT = "turtle-stuck-20260819-1629";
const CHEST_ID = "chest-island-turtle";
const FROM = "2026-08-19T08:16:00.000Z";
const TO = "2026-08-19T08:29:10.000Z";

function buildChestEntry(item, playerId) {
  return slimInventoryEntry({
    uuid: crypto.randomUUID(),
    itemId: item.id,
    itemName: item.name,
    itemEffect: item.effect || { type: "none", value: 0 },
    useEffects: item.useEffects || [],
    passiveEffects: item.passiveEffects || [],
    procEffects: item.procEffects || [],
    combatEffects: item.combatEffects || [],
    itemType: item.itemType || "consumable",
    imageUrl: item.imageUrl || null,
    imageThumbnailUrl: item.imageThumbnailUrl || null,
    equipSlot: item.equipSlot || null,
    equipStats: item.equipStats ? { ...item.equipStats } : {},
    weaponType: item.weaponType || null,
    isTwoHanded: Boolean(item.isTwoHanded),
    atkStat: item.atkStat || null,
    tier: item.tier || null,
    monsterCardSkill: item.monsterCardSkill || null,
    enhanceLevel: 0,
    stackCount: 1,
    source: "incident_compensation",
    sourceRef: `${INCIDENT}:chest:${playerId}`,
    obtainedAt: new Date().toISOString(),
  });
}

async function grantChestExactlyOnce(db, playerId, chestItem) {
  const ref = `${INCIDENT}:chest:${playerId}`;
  const entry = buildChestEntry(chestItem, playerId);
  const now = new Date().toISOString();

  // aggregation pipeline lets the chest increment/push and idempotency marker land atomically.
  const result = await db.collection("progress").updateOne(
    { playerId, compensationRefs: { $ne: ref } },
    [
      {
        $set: {
          inventory: {
            $let: {
              vars: {
                inv: { $ifNull: ["$inventory", []] },
                chestIndex: {
                  $indexOfArray: [
                    { $map: { input: { $ifNull: ["$inventory", []] }, as: "item", in: "$$item.itemId" } },
                    CHEST_ID,
                  ],
                },
              },
              in: {
                $cond: [
                  { $gte: ["$$chestIndex", 0] },
                  {
                    $map: {
                      input: { $range: [0, { $size: "$$inv" }] },
                      as: "idx",
                      in: {
                        $cond: [
                          { $eq: ["$$idx", "$$chestIndex"] },
                          {
                            $let: {
                              vars: { current: { $arrayElemAt: ["$$inv", "$$idx"] } },
                              in: {
                                $mergeObjects: [
                                  "$$current",
                                  {
                                    stackCount: {
                                      $add: [
                                        { $max: [1, { $ifNull: ["$$current.stackCount", 1] }] },
                                        1,
                                      ],
                                    },
                                  },
                                ],
                              },
                            },
                          },
                          { $arrayElemAt: ["$$inv", "$$idx"] },
                        ],
                      },
                    },
                  },
                  { $concatArrays: ["$$inv", [entry]] },
                ],
              },
            },
          },
          compensationRefs: { $setUnion: [{ $ifNull: ["$compensationRefs", []] }, [ref]] },
          updatedAt: now,
        },
      },
    ],
  );

  if (result.modifiedCount > 0) return { granted: true };
  const existing = await db.collection("progress").findOne(
    { playerId },
    { projection: { compensationRefs: 1 } },
  );
  if (existing?.compensationRefs?.includes(ref)) return { granted: false, duplicated: true };
  throw new Error(`找不到可更新的 progress：${playerId}`);
}

async function main() {
  const db = await getMongoDb();
  const rows = await db.collection("transactions").find({
    source: CURRENCY_SOURCES.MONSTER_ENTRY_FEE,
    sourceRef: "",
    amount: -3000,
    createdAt: { $gte: FROM, $lte: TO },
  }).sort({ createdAt: 1 }).toArray();

  const grouped = new Map();
  for (const row of rows) {
    const pid = String(row.playerId || "");
    if (!pid) continue;
    const group = grouped.get(pid) || { playerId: pid, count: 0, refund: 0 };
    group.count += 1;
    group.refund += Math.abs(Number(row.amount) || 0);
    grouped.set(pid, group);
  }

  const ids = [...grouped.keys()];
  const players = await db.collection("players").find(
    { discordId: { $in: ids } },
    { projection: { discordId: 1, displayName: 1, name: 1, nickname: 1 } },
  ).toArray();
  const names = new Map(players.map((p) => [
    String(p.discordId),
    String(p.displayName || p.nickname || p.name || p.discordId),
  ]));
  const chestItem = await db.collection("items").findOne({ id: CHEST_ID });
  if (!chestItem) throw new Error(`找不到寶箱道具：${CHEST_ID}`);

  const totalGold = [...grouped.values()].reduce((sum, g) => sum + g.refund, 0);
  console.log(`\n島島龜王事故補償（${APPLY ? "實際執行" : "DRY-RUN"}）`);
  console.log("─".repeat(72));
  for (const group of grouped.values()) {
    console.log(`  ${names.get(group.playerId) || group.playerId} (${group.playerId})：${group.count} 場，退 ${group.refund} 金幣，補 1 箱`);
  }
  console.log("─".repeat(72));
  console.log(`合計 ${rows.length} 場／${grouped.size} 人／退 ${totalGold} 金幣／補 ${grouped.size} 箱`);

  if (!APPLY) {
    console.log("DRY-RUN：未寫入。加 --yes 才會執行。");
    return;
  }
  if (rows.length !== 63 || grouped.size !== 3 || totalGold !== 189000) {
    throw new Error(`事故證據與預期不符，停止寫入：rows=${rows.length} players=${grouped.size} gold=${totalGold}`);
  }

  const repos = createRepositories();
  const playerService = new PlayerService(repos.playerRepository, repos.walletRepository, repos.progressRepository);
  const rewardService = new RewardService(playerService, repos.walletRepository, repos.transactionRepository);

  let refunded = 0;
  let chests = 0;
  for (const group of grouped.values()) {
    const name = names.get(group.playerId) || group.playerId;
    const money = await rewardService.grantCurrency({
      discordId: group.playerId,
      displayName: name,
      currencyType: "gold",
      amount: group.refund,
      source: CURRENCY_SOURCES.ADMIN_MANUAL_GRANT,
      sourceRef: `${INCIDENT}:entry-fee-refund:${group.playerId}`,
      operator: `compensation:${INCIDENT}`,
    });
    if (!money?.duplicated) refunded += group.refund;

    const chest = await grantChestExactlyOnce(db, group.playerId, chestItem);
    if (chest.granted) chests += 1;
    console.log(`  ${money?.duplicated ? "⏭️" : "✅"} ${name}：金幣${money?.duplicated ? "已補過" : ` +${group.refund}`}；寶箱${chest.duplicated ? "已補過" : " +1"}`);
  }
  console.log("─".repeat(72));
  console.log(`本次新寫入：${refunded} 金幣、${chests} 箱；其餘為已存在的冪等結果。`);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error("❌", error?.stack || error);
  process.exit(1);
});
