// 直播記錄層 Stream Records
// ------------------------------------------------
// 這裡只負責「把事件乾淨落地」，不含任何觸發後續獎勵/Buff 的邏輯。
// 兩份 log：
//   donationEvents   逐筆斗內事件（含未綁定/未滿百的，完整保存，不再混在 transactions）
//   membershipEvents 會員(Discord tier 身分組)加入/到期/升降級事件流水
//   membershipStatus 每個會員的目前狀態（現況表，一人一筆）
//
// 設計原則：best-effort，任何 DB 失敗都不可影響主流程（斗內發鑽 / Bot 事件）。

const { getMongoDb } = require("../../adapters/mongo/createMongoClient");

const TIER_ORDER = ["E", "D", "C", "B", "A", "S", "SS"];

/**
 * 依「舊最高等級 → 新最高等級」判斷會員變動類型。
 * @param {string|null} oldRank
 * @param {string|null} newRank
 * @returns {"join"|"expire"|"upgrade"|"downgrade"|null} null = 最高等級沒變
 */
function diffTier(oldRank, newRank) {
  const o = TIER_ORDER.indexOf(oldRank || "");
  const n = TIER_ORDER.indexOf(newRank || "");
  if (o === n) return null;
  if (o < 0 && n >= 0) return "join";
  if (o >= 0 && n < 0) return "expire";
  return n > o ? "upgrade" : "downgrade";
}

// ---------------------------------------------------------------------------
// 斗內事件記錄
// ---------------------------------------------------------------------------

/**
 * 記錄一筆斗內事件（冪等：同 sourceRef 只寫一次，事件重觸發不重複記）。
 * @param {object} evt
 * @param {string} [evt.sourceRef]
 * @param {string} evt.platform
 * @param {string} evt.platformUserId
 * @param {string} evt.displayName
 * @param {number} evt.twdAmount
 * @param {string|null} [evt.currency]
 * @param {string|null} [evt.discordId] 綁定玩家（未綁定為 null）
 * @param {boolean} evt.bound
 * @param {number} [evt.diamondsGranted]
 * @param {number} [evt.pendingAfter] 本次結算後尚未湊滿百的零頭
 * @param {boolean} [evt.isMember] 事件當下是否為會員（依平台徽章推斷）
 * @param {string|null} [evt.supportKind]
 * @param {string|null} [evt.note]
 */
async function recordDonationEvent(evt) {
  const db = await getMongoDb().catch(() => null);
  if (!db) return;
  const now = new Date();
  const doc = {
    sourceRef: evt.sourceRef || null,
    platform: evt.platform || null,
    platformUserId: evt.platformUserId || null,
    displayName: evt.displayName || null,
    twdAmount: Number(evt.twdAmount) || 0,
    currency: evt.currency || null,
    discordId: evt.discordId || null,
    bound: Boolean(evt.bound),
    diamondsGranted: Number(evt.diamondsGranted) || 0,
    pendingAfter: Number(evt.pendingAfter) || 0,
    isMember: Boolean(evt.isMember),
    supportKind: evt.supportKind || null,
    note: evt.note || null,
    createdAt: now.toISOString(),
    createdAtDate: now
  };
  try {
    if (evt.sourceRef) {
      await db.collection("donationEvents").updateOne(
        { sourceRef: evt.sourceRef },
        { $setOnInsert: doc },
        { upsert: true }
      );
    } else {
      await db.collection("donationEvents").insertOne(doc);
    }
  } catch (err) {
    console.warn("[StreamRecords] recordDonationEvent 失敗：", err?.message || err);
  }
}

// ---------------------------------------------------------------------------
// 會員變動記錄
// ---------------------------------------------------------------------------

/**
 * 記錄一筆會員變動，同時更新現況表 membershipStatus。
 * @param {object} change
 * @param {string} change.discordId
 * @param {string} change.displayName
 * @param {"join"|"rejoin"|"expire"|"upgrade"|"downgrade"|"role_change"} change.event
 * @param {string|null} change.fromTier
 * @param {string|null} change.toTier
 * @param {string|null} [change.fromLabel]
 * @param {string|null} [change.toLabel]
 * @param {string[]} [change.addedTierRoleIds]
 * @param {string[]} [change.removedTierRoleIds]
 * @param {string} [change.source] 資料來源 discord_role / youtube_api
 */
async function recordMembershipChange(change) {
  const db = await getMongoDb().catch(() => null);
  if (!db) return;
  const now = new Date();
  const iso = now.toISOString();
  const discordId = String(change.discordId || "");
  if (!discordId) return;

  let event = change.event;
  // 若判定為 join，但這人以前曾是會員（現況表有 firstJoinedAt）→ 記為 rejoin(回鍋)
  try {
    if (event === "join") {
      const existing = await db.collection("membershipStatus").findOne({ discordId });
      if (existing?.firstJoinedAt) event = "rejoin";
    }
  } catch (_) { /* 讀失敗就當一般 join */ }

  const logDoc = {
    discordId,
    displayName: change.displayName || null,
    event,
    fromTier: change.fromTier || null,
    toTier: change.toTier || null,
    fromLabel: change.fromLabel || null,
    toLabel: change.toLabel || null,
    addedTierRoleIds: Array.isArray(change.addedTierRoleIds) ? change.addedTierRoleIds : [],
    removedTierRoleIds: Array.isArray(change.removedTierRoleIds) ? change.removedTierRoleIds : [],
    source: change.source || "discord_role",
    at: iso,
    atDate: now
  };

  try {
    await db.collection("membershipEvents").insertOne(logDoc);
  } catch (err) {
    console.warn("[StreamRecords] membershipEvents 寫入失敗：", err?.message || err);
  }

  // 更新現況表
  const isMember = Boolean(change.toTier);
  const set = {
    discordId,
    displayName: change.displayName || null,
    currentTier: change.toTier || null,
    currentLabel: change.toLabel || null,
    isMember,
    lastEvent: event,
    lastChangedAt: iso
  };
  // 只要目前是會員，就同步「最後確認為會員」的時間戳（供時間判斷用）
  if (isMember) set.lastMemberConfirmedAt = iso;
  const setOnInsert = { firstSeenAt: iso };
  const inc = {};
  if (event === "join" || event === "rejoin") {
    set.lastJoinedAt = iso;
    setOnInsert.firstJoinedAt = iso;
    if (event === "rejoin") inc.rejoinCount = 1;
  }
  if (event === "expire") {
    set.lastExpiredAt = iso;
    inc.expireCount = 1;
  }
  const update = { $set: set, $setOnInsert: setOnInsert };
  if (Object.keys(inc).length > 0) update.$inc = inc;

  try {
    await db.collection("membershipStatus").updateOne({ discordId }, update, { upsert: true });
  } catch (err) {
    console.warn("[StreamRecords] membershipStatus 更新失敗：", err?.message || err);
  }
}

/**
 * 快照確認：某人「這次掃描仍是會員、且等級沒變」時呼叫。
 * 只更新「最後確認時間」與現況，不寫事件流水（避免每次快照都灌 log）。
 */
async function touchMemberConfirmed({ discordId, displayName, tier, label }) {
  const db = await getMongoDb().catch(() => null);
  if (!db) return;
  const iso = new Date().toISOString();
  const did = String(discordId || "");
  if (!did) return;
  try {
    await db.collection("membershipStatus").updateOne(
      { discordId: did },
      {
        $set: {
          displayName: displayName || null,
          currentTier: tier || null,
          currentLabel: label || null,
          isMember: true,
          lastMemberConfirmedAt: iso
        },
        $setOnInsert: { firstSeenAt: iso, firstJoinedAt: iso }
      },
      { upsert: true }
    );
  } catch (err) {
    console.warn("[StreamRecords] touchMemberConfirmed 失敗：", err?.message || err);
  }
}

// ---------------------------------------------------------------------------
// 查詢（給後台看記錄用）
// ---------------------------------------------------------------------------

async function listDonationEvents({ limit = 100, boundOnly = false } = {}) {
  const db = await getMongoDb().catch(() => null);
  if (!db) return [];
  const q = boundOnly ? { bound: true } : {};
  return db.collection("donationEvents")
    .find(q, { projection: { createdAtDate: 0 } })
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(Number(limit) || 100, 1), 500))
    .toArray();
}

async function getDonationSummary() {
  const db = await getMongoDb().catch(() => null);
  if (!db) return { totalEvents: 0, boundEvents: 0, totalTwd: 0, totalDiamonds: 0 };
  const rows = await db.collection("donationEvents").aggregate([
    {
      $group: {
        _id: null,
        totalEvents: { $sum: 1 },
        boundEvents: { $sum: { $cond: ["$bound", 1, 0] } },
        totalTwd: { $sum: "$twdAmount" },
        totalDiamonds: { $sum: "$diamondsGranted" }
      }
    }
  ]).toArray();
  const r = rows[0] || {};
  return {
    totalEvents: r.totalEvents || 0,
    boundEvents: r.boundEvents || 0,
    totalTwd: r.totalTwd || 0,
    totalDiamonds: r.totalDiamonds || 0
  };
}

async function listMembershipEvents({ limit = 100 } = {}) {
  const db = await getMongoDb().catch(() => null);
  if (!db) return [];
  return db.collection("membershipEvents")
    .find({}, { projection: { atDate: 0 } })
    .sort({ at: -1 })
    .limit(Math.min(Math.max(Number(limit) || 100, 1), 500))
    .toArray();
}

async function listMembershipStatuses({ activeOnly = false, limit = 500 } = {}) {
  const db = await getMongoDb().catch(() => null);
  if (!db) return [];
  const q = activeOnly ? { isMember: true } : {};
  return db.collection("membershipStatus")
    .find(q)
    .sort({ lastChangedAt: -1 })
    .limit(Math.min(Math.max(Number(limit) || 500, 1), 1000))
    .toArray();
}

module.exports = {
  TIER_ORDER,
  diffTier,
  recordDonationEvent,
  recordMembershipChange,
  touchMemberConfirmed,
  listDonationEvents,
  getDonationSummary,
  listMembershipEvents,
  listMembershipStatuses
};
