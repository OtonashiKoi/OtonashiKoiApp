// SC 累積條 SC Accumulation Bar（模組 B）
// ------------------------------------------------
// 全服共同的斗內累積計數：斗內進來就 +金額，跨里程碑就解鎖對應獎勵(全服 buff)。
// 里程碑獎勵由 streamEventConfig 設定；清除由後台手動重置並保留歷史。
//
// 狀態：collection scAccumulator，單一 doc _id:"current"
//   { total, startedAt, periodLabel, claimedMilestoneIds:[], updatedAt }
// 里程碑設定：streamEventConfig.scBar.milestones（見 streamEventConfig.js）

const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
const globalBuff = require("./globalBuffService");
const { applyBuff } = globalBuff;
const { getConfig } = require("./streamEventConfig");

const DOC_ID = "current";

function defaultState() {
  return { _id: DOC_ID, total: 0, startedAt: null, periodLabel: null, claimedMilestoneIds: [] };
}

async function getState() {
  const db = await getMongoDb().catch(() => null);
  if (!db) return defaultState();
  const doc = await db.collection("scAccumulator").findOne({ _id: DOC_ID });
  return doc || defaultState();
}

/** 斗內進來 → 累積 + 檢查里程碑解鎖。best-effort。 */
async function addDonation(twdAmount, meta, serviceContext) {
  const amt = Math.max(0, Number(twdAmount) || 0);
  if (amt <= 0) return { total: 0, unlocked: [] };
  const db = await getMongoDb().catch(() => null);
  if (!db) return { total: 0, unlocked: [] };

  const nowIso = new Date().toISOString();
  // 累加（doc 不存在則建立，帶上起始時間）
  const after = await db.collection("scAccumulator").findOneAndUpdate(
    { _id: DOC_ID },
    { $inc: { total: amt }, $set: { updatedAt: nowIso }, $setOnInsert: { startedAt: nowIso, claimedMilestoneIds: [], periodLabel: null } },
    { upsert: true, returnDocument: "after" }
  );
  const state = after?.value || after || (await getState());
  const total = Number(state.total) || amt;

  const cfg = (await getConfig()).scBar;
  const unlocked = [];
  // 里程碑只在「啟用」時才會發獎；未啟用時只累積、不解鎖
  if (cfg.enabled && Array.isArray(cfg.milestones)) {
    const claimed = new Set(Array.isArray(state.claimedMilestoneIds) ? state.claimedMilestoneIds : []);
    // 本次累積後「新達成」的里程碑（用於逐一廣播）
    const newly = cfg.milestones
      .filter((m) => m && Number(m.threshold) > 0 && total >= Number(m.threshold) && !claimed.has(m.id))
      .sort((a, b) => Number(a.threshold) - Number(b.threshold));

    for (const m of newly) {
      // 原子搶佔：只有把 id 加進 claimed 的那一次才發獎，避免併發重複觸發
      const claim = await db.collection("scAccumulator").updateOne(
        { _id: DOC_ID, claimedMilestoneIds: { $ne: m.id } },
        { $addToSet: { claimedMilestoneIds: m.id } }
      );
      if (!claim.modifiedCount) continue;
      // 疊加式：每階各自套一個「賽季永久」buff，全部相加、永久保留（換季 resetSeason 清）
      if (Number(m.dropPct) > 0 || Number(m.goldPct) > 0 || Number(m.expPct) > 0) {
        await applyBuff({
          label: `賽季永久 · SC累積：${m.label || ("NT$" + m.threshold)}`,
          source: "sc_milestone",
          sourceRef: `scms:season:${m.id}`, // 每階唯一、可共存疊加
          dropPct: Number(m.dropPct) || 0, goldPct: Number(m.goldPct) || 0, expPct: Number(m.expPct) || 0,
          seasonPermanent: true, createdBy: "stream:sc-bar",
        }).catch(() => {});
      }
      unlocked.push({ id: m.id, threshold: m.threshold, label: m.label });
      if (m.announce !== false && typeof serviceContext?._announceTownChat === "function") {
        const parts = [];
        if (Number(m.dropPct) > 0) parts.push(`掉寶 +${m.dropPct}%`);
        if (Number(m.goldPct) > 0) parts.push(`金幣 +${m.goldPct}%`);
        if (Number(m.expPct) > 0) parts.push(`經驗 +${m.expPct}%`);
        const eff = parts.length ? `全服 ${parts.join("、")}（本賽季永久保留）！` : "";
        try {
          serviceContext._announceTownChat(`🔓 全服 SC 累積達 NT$${m.threshold}！解鎖「${m.label || ""}」${eff}`);
        } catch (_) { /* noop */ }
      }
    }
  }

  return { total, unlocked };
}

/** 重置累積條（清除方法之一：手動）。可選 archive 到 scBarHistory。 */
async function reset({ archive = true, periodLabel = null } = {}) {
  const db = await getMongoDb().catch(() => null);
  if (!db) return { reset: false };
  const prev = await db.collection("scAccumulator").findOne({ _id: DOC_ID });
  if (archive && prev && Number(prev.total) > 0) {
    await db.collection("scBarHistory").insertOne({
      total: prev.total, startedAt: prev.startedAt, endedAt: new Date().toISOString(),
      periodLabel: prev.periodLabel, claimedMilestoneIds: prev.claimedMilestoneIds || []
    }).catch(() => {});
  }
  const nowIso = new Date().toISOString();
  await db.collection("scAccumulator").updateOne(
    { _id: DOC_ID },
    { $set: { total: 0, claimedMilestoneIds: [], startedAt: nowIso, periodLabel: periodLabel || null, updatedAt: nowIso } },
    { upsert: true }
  );
  return { reset: true, archivedTotal: prev?.total || 0 };
}

/** 給前端/後台的進度資料（含各里程碑是否已解鎖、下一個目標） */
async function getPublicProgress() {
  const state = await getState();
  const cfg = (await getConfig()).scBar;
  const claimed = new Set(Array.isArray(state.claimedMilestoneIds) ? state.claimedMilestoneIds : []);
  const total = Number(state.total) || 0;
  const milestones = (Array.isArray(cfg.milestones) ? cfg.milestones : [])
    .filter((m) => m && Number(m.threshold) > 0)
    .sort((a, b) => Number(a.threshold) - Number(b.threshold))
    .map((m) => ({
      id: m.id, threshold: Number(m.threshold), label: m.label || "",
      dropPct: Number(m.dropPct) || 0, goldPct: Number(m.goldPct) || 0, expPct: Number(m.expPct) || 0,
      durationMinutes: Number(m.durationMinutes) || 0,
      claimed: claimed.has(m.id) || total >= Number(m.threshold)
    }));
  const next = milestones.find((m) => total < m.threshold) || null;
  return {
    enabled: !!cfg.enabled,
    total,
    startedAt: state.startedAt || null,
    periodLabel: state.periodLabel || null,
    nextMilestone: next,
    maxThreshold: milestones.length ? milestones[milestones.length - 1].threshold : 0,
    milestones
  };
}

module.exports = { getState, addDonation, reset, getPublicProgress };
