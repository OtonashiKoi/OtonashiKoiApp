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

// 斗內記錄分段點（使用者 2026-08-09 指示）：台北 8/9 晚上 8 點起算「新一輪」，
// 之前的歸「舊紀錄」。後台列表可依此篩選、彙總卡分兩段各算各的。
const DONATION_PHASE2_START = "2026-08-09T12:00:00.000Z"; // = 台北 2026-08-09 20:00

async function listDonationEvents({ limit = 100, boundOnly = false, phase = "" } = {}) {
  const db = await getMongoDb().catch(() => null);
  if (!db) return [];
  const q = boundOnly ? { bound: true } : {};
  if (phase === "old") q.createdAt = { $lt: DONATION_PHASE2_START };
  else if (phase === "new") q.createdAt = { $gte: DONATION_PHASE2_START };
  return db.collection("donationEvents")
    .find(q, { projection: { createdAtDate: 0 } })
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(Number(limit) || 100, 1), 500))
    .toArray();
}

async function getDonationSummary() {
  const db = await getMongoDb().catch(() => null);
  const empty = { totalEvents: 0, boundEvents: 0, totalTwd: 0, totalDiamonds: 0 };
  if (!db) return { ...empty, phases: { cutoff: DONATION_PHASE2_START, old: empty, new: empty } };
  const groupSpec = {
    _id: null,
    totalEvents: { $sum: 1 },
    boundEvents: { $sum: { $cond: ["$bound", 1, 0] } },
    totalTwd: { $sum: "$twdAmount" },
    totalDiamonds: { $sum: "$diamondsGranted" }
  };
  const pick = (rows) => {
    const r = (rows && rows[0]) || {};
    return {
      totalEvents: r.totalEvents || 0,
      boundEvents: r.boundEvents || 0,
      totalTwd: r.totalTwd || 0,
      totalDiamonds: r.totalDiamonds || 0
    };
  };
  const rows = await db.collection("donationEvents").aggregate([
    {
      $facet: {
        all: [{ $group: groupSpec }],
        old: [{ $match: { createdAt: { $lt: DONATION_PHASE2_START } } }, { $group: groupSpec }],
        new: [{ $match: { createdAt: { $gte: DONATION_PHASE2_START } } }, { $group: groupSpec }]
      }
    }
  ]).toArray();
  const f = rows[0] || {};
  // 頂層維持舊欄位（全部合計）不破壞既有呼叫端；分段放 phases
  return { ...pick(f.all), phases: { cutoff: DONATION_PHASE2_START, old: pick(f.old), new: pick(f.new) } };
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

// 綁定會員判定條件（遊戲內 resolveAuctionMembership 同口徑）：
//   streamAccountBindings 任一 isMember / linkedSupportAtLink / playerTierAtLink 有值
const BINDING_MEMBER_QUERY = {
  $or: [
    { isMember: true },
    { linkedSupportAtLink: true },
    { playerTierAtLink: { $nin: [null, ""] } }
  ]
};

/**
 * 目前活躍會員的「不重複 discordId 清單」。
 * 口徑＝遊戲內一致：直播綁定(streamAccountBindings) ∪ Discord 身分組(membershipStatus)，任一即會員。
 */
async function listActiveMemberIds() {
  const db = await getMongoDb().catch(() => null);
  if (!db) return [];
  const [boundIds, roleIds] = await Promise.all([
    db.collection("streamAccountBindings").distinct("discordId", BINDING_MEMBER_QUERY).catch(() => []),
    db.collection("membershipStatus").distinct("discordId", { isMember: true }).catch(() => [])
  ]);
  const set = new Set();
  for (const id of boundIds) if (id != null && String(id).trim() !== "") set.add(String(id));
  for (const id of roleIds) if (id != null && String(id).trim() !== "") set.add(String(id));
  return [...set];
}

async function countActiveMembers() {
  return (await listActiveMemberIds()).length;
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

/**
 * 後台顯示用「會員總表」：Discord 身分組(membershipStatus) ∪ 直播綁定(streamAccountBindings)。
 * 口徑跟遊戲內一致 —— 綁定會員即使沒有 Discord 身分組也會出現、也算會員；反之亦然。
 * - source: "role"（只身分組）/ "binding"（只綁定）/ "both"（兩者都有）
 * - 綁定會員只要任一平台達標，isMember 一律 true（覆蓋身分組 tracker 的 false）
 */
async function listMemberDirectory({ activeOnly = false, limit = 1000 } = {}) {
  const db = await getMongoDb().catch(() => null);
  if (!db) return [];
  const [statuses, bindings] = await Promise.all([
    db.collection("membershipStatus").find({}).toArray().catch(() => []),
    db.collection("streamAccountBindings")
      .find(BINDING_MEMBER_QUERY, { projection: { discordId: 1, displayName: 1, platform: 1, playerTierAtLink: 1, linkedAt: 1, linkedSupportAtLink: 1 } })
      .toArray().catch(() => [])
  ]);

  // 綁定會員 → 依 discordId 聚合（一人可能多平台）
  const bindMap = new Map();
  for (const b of bindings) {
    const id = b.discordId != null ? String(b.discordId) : "";
    if (!id) continue;
    const cur = bindMap.get(id) || { platforms: [], displayName: null, tier: null, linkedAt: null };
    cur.platforms.push(b.platform);
    if (!cur.displayName && b.displayName) cur.displayName = b.displayName;
    if (!cur.tier && b.playerTierAtLink) cur.tier = b.playerTierAtLink;
    if (b.linkedAt && (!cur.linkedAt || b.linkedAt > cur.linkedAt)) cur.linkedAt = b.linkedAt;
    bindMap.set(id, cur);
  }

  const rows = new Map();
  for (const s of statuses) {
    const id = String(s.discordId || "");
    if (!id) continue;
    const bind = bindMap.get(id);
    rows.set(id, {
      ...s,
      isMember: Boolean(s.isMember) || Boolean(bind),         // 綁定會員覆蓋身分組 tracker 的 false
      currentTier: s.currentTier || bind?.tier || null,
      displayName: s.displayName || bind?.displayName || id,
      firstJoinedAt: s.firstJoinedAt || bind?.linkedAt || null,
      source: bind ? "both" : "role",
      bindingPlatforms: bind ? bind.platforms : []
    });
  }
  // 只在綁定、身分組名單沒有的人 → 補進來
  for (const [id, bind] of bindMap) {
    if (rows.has(id)) continue;
    rows.set(id, {
      discordId: id,
      displayName: bind.displayName || id,
      isMember: true,
      currentTier: bind.tier || null,
      currentLabel: bind.tier || null,
      firstJoinedAt: bind.linkedAt || null,
      lastConfirmedAt: bind.linkedAt || null,
      lastChangedAt: bind.linkedAt || null,
      source: "binding",
      bindingPlatforms: bind.platforms
    });
  }

  let list = [...rows.values()];
  if (activeOnly) list = list.filter((r) => r.isMember);
  list.sort((a, b) => String(b.lastChangedAt || "").localeCompare(String(a.lastChangedAt || "")));
  return list.slice(0, Math.min(Math.max(Number(limit) || 1000, 1), 2000));
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
  listMembershipStatuses,
  listMemberDirectory,
  listActiveMemberIds,
  countActiveMembers
};
