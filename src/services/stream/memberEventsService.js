// 會員事件（第三線）
// 依綁定會員數(countActiveMembers)：
//   - 短期慶祝：每突破 everyN 的倍數「新高」→ 短期全服 buff
//   - 賽季永久里程碑：會員數「曾達到」門檻(high-water-mark) → 賽季永久底盤（會員後續掉了也不收回）
// 狀態 memberEventsState/_id:"default"：high(本季最高會員數) / claimedMilestoneIds / lastCelebratedMultiple
const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
const { countActiveMembers } = require("./streamRecordsService");
const { getConfig } = require("./streamEventConfig");
const globalBuff = require("./globalBuffService");
const { applyBuff } = globalBuff;

const DOC_ID = "default";

async function getState() {
  const db = await getMongoDb().catch(() => null);
  if (!db) return { high: 0, claimedMilestoneIds: [], lastCelebratedMultiple: 0 };
  const doc = await db.collection("memberEventsState").findOne({ _id: DOC_ID });
  return {
    high: Number(doc?.high) || 0,
    claimedMilestoneIds: Array.isArray(doc?.claimedMilestoneIds) ? doc.claimedMilestoneIds : [],
    lastCelebratedMultiple: Number(doc?.lastCelebratedMultiple) || 0,
  };
}

/** 檢查會員數，發短期慶祝 + 賽季永久里程碑。best-effort。 */
async function check(serviceContext) {
  try {
    const cfg = (await getConfig()).memberEvents;
    if (!cfg.enabled) return { changed: false, reason: "disabled" };
    const db = await getMongoDb().catch(() => null);
    if (!db) return { changed: false };
    const count = await countActiveMembers();
    const state = await getState();
    if (count <= state.high) return { count, changed: false }; // 沒創新高，不動作

    const announce = (msg) => { try { serviceContext?._announceTownChat?.(msg); } catch (_) { /* noop */ } };
    const result = { count, celebrated: false, unlocked: [] };

    // 1) 短期慶祝：跨過新的 everyN 倍數
    const everyN = Math.max(1, Number(cfg.shortBuff?.everyN) || 5);
    const newMultiple = Math.floor(count / everyN) * everyN;
    const sb = cfg.shortBuff || {};
    if (newMultiple >= everyN && newMultiple > state.lastCelebratedMultiple &&
        (sb.dropPct > 0 || sb.goldPct > 0 || sb.expPct > 0)) {
      const r = await applyBuff({
        label: `${sb.label || "新會員慶祝"}（會員突破 ${newMultiple} 人）`,
        source: "member_celebrate",
        sourceRef: `memcelebrate:${newMultiple}`,
        dropPct: sb.dropPct, goldPct: sb.goldPct, expPct: sb.expPct,
        durationMs: Math.max(1, Number(sb.durationMinutes) || 30) * 60_000,
        createdBy: "stream:member",
      });
      if (r.applied) {
        result.celebrated = true;
        if (cfg.announce) announce(`🎉 綁定會員突破 ${newMultiple} 人！全服短時加成，感謝大家一起撐場！`);
      }
    }

    // 2) 賽季永久里程碑（疊加式：每階各自永久保留、相加；high-water-mark 一次性）
    for (const m of (cfg.milestones || [])) {
      if (count < m.count) continue;
      const claim = await db.collection("memberEventsState").updateOne(
        { _id: DOC_ID, claimedMilestoneIds: { $ne: m.id } },
        { $addToSet: { claimedMilestoneIds: m.id } },
        { upsert: true }
      );
      if (!claim.modifiedCount && !claim.upsertedCount) continue; // 別人搶到了
      if (m.dropPct > 0 || m.goldPct > 0 || m.expPct > 0) {
        await applyBuff({
          label: `賽季永久 · 會員達 ${m.count} 人：${m.label || ""}`,
          source: "member_milestone",
          sourceRef: `memms:season:${m.id}`, // 每階唯一、可共存疊加
          dropPct: m.dropPct, goldPct: m.goldPct, expPct: m.expPct,
          seasonPermanent: true, createdBy: "stream:member",
        }).catch(() => {});
      }
      result.unlocked.push({ id: m.id, count: m.count, label: m.label });
      if (cfg.announce) {
        const parts = [];
        if (m.dropPct > 0) parts.push(`掉寶 +${m.dropPct}%`);
        if (m.goldPct > 0) parts.push(`金幣 +${m.goldPct}%`);
        if (m.expPct > 0) parts.push(`經驗 +${m.expPct}%`);
        announce(`🔓 綁定會員達 ${m.count} 人！本賽季永久保留 全服 ${parts.join("、")}！`);
      }
    }

    // 3) 更新 high-water-mark + 已慶祝倍數
    await db.collection("memberEventsState").updateOne(
      { _id: DOC_ID },
      { $max: { high: count, lastCelebratedMultiple: newMultiple }, $set: { updatedAt: new Date().toISOString() }, $setOnInsert: { startedAt: new Date().toISOString() } },
      { upsert: true }
    );
    return { ...result, changed: true };
  } catch (err) {
    console.warn("[MemberEvents] check 失敗：", err?.message || err);
    return { changed: false, reason: "error" };
  }
}

/** 換季重置：清 high-water-mark + claimed（賽季永久 buff 由 globalBuffService.resetSeason 清） */
async function resetSeason() {
  const db = await getMongoDb().catch(() => null);
  if (!db) return { reset: false };
  const iso = new Date().toISOString();
  await db.collection("memberEventsState").updateOne(
    { _id: DOC_ID },
    { $set: { high: 0, claimedMilestoneIds: [], lastCelebratedMultiple: 0, startedAt: iso, updatedAt: iso } },
    { upsert: true }
  );
  return { reset: true };
}

/** 前端顯示：目前會員數 + 里程碑進度 */
async function getPublicProgress() {
  const cfg = (await getConfig()).memberEvents;
  const state = await getState();
  const count = await countActiveMembers();
  const claimed = new Set(state.claimedMilestoneIds);
  const milestones = (cfg.milestones || []).map((m) => ({ ...m, claimed: claimed.has(m.id) || state.high >= m.count }));
  const next = milestones.find((m) => !m.claimed) || null;
  return {
    enabled: cfg.enabled, count, high: state.high,
    nextMilestone: next, milestones,
    maxThreshold: milestones.length ? milestones[milestones.length - 1].count : 0,
  };
}

module.exports = { check, resetSeason, getPublicProgress, getState };
