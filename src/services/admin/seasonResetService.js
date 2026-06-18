"use strict";
/**
 * 回歸賽季重製方案(可重複使用的固定工具)。
 * 把指定玩家的資料重置成全新賽季,只保留:
 *   - 鑽石(wallet.diamond)
 *   - 稱號(equipSlot "title_eq" 或 itemType "title";含已裝備的稱號)
 *   - 收藏圖片(itemType "collectible" / "collection")
 * 其餘全部重置:金幣歸 0、等級歸 1、屬性/裝備/背包/寵物/圖鑑/任務/打卡/PK/會員位階…全部清空,
 * 以全新玩家(createGameProgress)為基準。
 */

const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
const { createGameProgress } = require("../../domain/progress/createGameProgress");
const { slimInventoryArray } = require("../../shared/inventoryStorage");

function isTitle(it) {
  return String(it?.equipSlot) === "title_eq" || String(it?.itemType || "").toLowerCase() === "title";
}
function isCollectible(it) {
  return ["collectible", "collection"].includes(String(it?.itemType || "").toLowerCase());
}

/** 重置前的完整備份(progress / wallet / 任務 / 打卡 / 拍賣上架 / 交易),回傳物件供寫檔保存 */
async function buildSeasonResetBackup(discordId) {
  const id = String(discordId || "").trim();
  const db = await getMongoDb();
  const [progress, wallet, quests, checkins, auctions, transactions] = await Promise.all([
    db.collection("progress").findOne({ playerId: id }),
    db.collection("wallets").findOne({ playerId: id }),
    db.collection("weeklyQuestProgress").find({ $or: [{ discordId: id }, { playerId: id }] }).toArray().catch(() => []),
    db.collection("checkins").find({ $or: [{ discordId: id }, { playerId: id }] }).toArray().catch(() => []),
    db.collection("auctions").find({ sellerId: id }).toArray().catch(() => []),
    db.collection("transactions").find({ playerId: id }).toArray().catch(() => [])
  ]);
  return { kind: "season-reset-backup", discordId: id, at: new Date().toISOString(), progress, wallet, quests, checkins, auctions, transactions };
}

/**
 * 執行回歸賽季重製。
 * @param {string} discordId
 * @param {{ dryRun?: boolean }} options dryRun=true 只回傳將保留/移除的統計,不寫入。
 */
async function seasonResetPlayer(discordId, { dryRun = false } = {}) {
  const id = String(discordId || "").trim();
  if (!id) throw new Error("discordId required");
  const db = await getMongoDb();

  const old = await db.collection("progress").findOne({ playerId: id });
  if (!old) throw new Error("找不到該玩家的進度資料");
  const wallet = await db.collection("wallets").findOne({ playerId: id });

  const inv = Array.isArray(old.inventory) ? old.inventory : [];
  const keptInv = inv.filter((it) => isTitle(it) || isCollectible(it));
  const keptTitleEq = old.equipment?.title_eq || null;

  // 拍賣上架(以賣家計) + 交易紀錄,一併清掉(全新賽季)
  const [auctionCount, transactionCount] = await Promise.all([
    db.collection("auctions").countDocuments({ sellerId: id }).catch(() => 0),
    db.collection("transactions").countDocuments({ playerId: id }).catch(() => 0)
  ]);

  const summary = {
    discordId: id,
    keptDiamond: Number(wallet?.diamond) || 0,
    keptTitlesInBag: keptInv.filter(isTitle).length,
    keptTitleEquipped: keptTitleEq ? 1 : 0,
    keptCollectibles: keptInv.filter(isCollectible).length,
    removedInventoryItems: inv.length - keptInv.length,
    removedAuctions: auctionCount,
    removedTransactions: transactionCount,
    goldBefore: Number(wallet?.gold) || 0,
    levelBefore: Number(old.level) || 1,
    dryRun
  };
  if (dryRun) return summary;

  // 以全新玩家為基準,塞回保留項目
  const fresh = createGameProgress(id);
  fresh.inventory = slimInventoryArray(keptInv);
  fresh.equipment.title_eq = keptTitleEq;
  fresh.createdAt = old.createdAt || new Date().toISOString();
  fresh.updatedAt = new Date().toISOString();

  // replaceOne:整份取代,確保 pets/bestiary/pkWins/playerTier 等舊欄位一併消失
  await db.collection("progress").replaceOne({ playerId: id }, fresh);
  // 金幣歸 0、鑽石保留
  await db.collection("wallets").updateOne({ playerId: id }, { $set: { gold: 0, updatedAt: new Date().toISOString() } });
  // 任務 / 打卡進度清空(全新賽季)
  await db.collection("weeklyQuestProgress").deleteMany({ $or: [{ discordId: id }, { playerId: id }] });
  await db.collection("checkins").deleteMany({ $or: [{ discordId: id }, { playerId: id }] });
  // 拍賣上架(賣家) + 交易紀錄清空(避免殘留指向已清空道具的上架/舊交易)
  await db.collection("auctions").deleteMany({ sellerId: id });
  await db.collection("transactions").deleteMany({ playerId: id });

  return summary;
}

/** 列出所有有進度資料的玩家 id */
async function listAllPlayerIds() {
  const db = await getMongoDb();
  const rows = await db.collection("progress").find({}, { projection: { playerId: 1 } }).toArray();
  return rows.map((r) => String(r.playerId || "").trim()).filter(Boolean);
}

/**
 * 全體回歸賽季重製。逐一備份 + 重製每位玩家,回傳彙總統計。
 * @param {{ onBackup?: (allBackups:Array)=>Promise<void>, dryRun?: boolean }} options
 */
async function seasonResetAllPlayers({ onBackup = null, dryRun = false } = {}) {
  const ids = await listAllPlayerIds();
  if (dryRun) return { total: ids.length, dryRun: true };

  // 先把所有玩家備份收集起來交給呼叫端寫檔(失敗就中止,不動任何資料)
  if (typeof onBackup === "function") {
    const backups = [];
    for (const id of ids) backups.push(await buildSeasonResetBackup(id));
    await onBackup(backups);
  }

  const agg = { total: ids.length, succeeded: 0, failed: 0, removedAuctions: 0, removedTransactions: 0, removedInventoryItems: 0, errors: [] };
  for (const id of ids) {
    try {
      const s = await seasonResetPlayer(id, { dryRun: false });
      agg.succeeded += 1;
      agg.removedAuctions += Number(s.removedAuctions) || 0;
      agg.removedTransactions += Number(s.removedTransactions) || 0;
      agg.removedInventoryItems += Number(s.removedInventoryItems) || 0;
    } catch (e) {
      agg.failed += 1;
      if (agg.errors.length < 20) agg.errors.push({ id, message: e.message });
    }
  }
  return agg;
}

module.exports = { seasonResetPlayer, buildSeasonResetBackup, listAllPlayerIds, seasonResetAllPlayers };
