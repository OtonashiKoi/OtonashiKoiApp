"use strict";
/**
 * KDA 貢獻系統（設計：docs/SEASON_NEXT_SURVIVAL_15R_DESIGN.md 附錄C v3）。
 *
 * 賽季累積（collection: kdaSeasonStats，換季清檔隨 seasonReset 重建）：
 *   k         對世界王總傷害（含 DoT；來源＝各入口結算的本場傷害）
 *   a         助攻傷害當量（combatLoop assistLedger 已含光環、控制與聖域窗口歸戶）
 *   d         世界王戰鬥陣亡次數（防刷原則 6：只算世界王場次）
 *   wbBattles 世界王出戰場次（存活係數的分母）
 *   jobStats  從 2026-08-15 起按戰鬥／提供能力當下的職業分開累積；舊總計不猜測回填
 *
 * 公式（使用者定案 2026-08-07）：
 *   存活係數 = max(0.5, 1 − max(0, 死亡率 − 免責10%) × 0.8)
 *   貢獻分 C = (K + 0.7 × A) × 存活係數
 *   KDA 值   = (K + A) ÷ max(1, D)      ← 聊天室爽度數字，排名不用它
 */
const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
const { getLeaderboardExcludedPlayerIds } = require("../../shared/leaderboardEligibility");
const { safeJobKey } = require("../../shared/supportContribution");

const EXEMPT_DEATH_RATE = 0.10; // 免責門檻（附錄C 十：待真實賽季數據校準）
const A_WEIGHT = 0.7;
const COEF_FLOOR = 0.5;
const COL = "kdaSeasonStats";

function survivalCoef(d, battles) {
  const dr = battles > 0 ? d / battles : 0;
  return Math.max(COEF_FLOOR, 1 - Math.max(0, dr - EXEMPT_DEATH_RATE) * 0.8);
}

function contributionScore(row) {
  const k = Number(row?.k) || 0;
  const a = Number(row?.a) || 0;
  return (k + A_WEIGHT * a) * survivalCoef(Number(row?.d) || 0, Number(row?.wbBattles) || 0);
}

/**
 * 記一場世界王戰鬥：自己的 K/D/場次 ＋ 把 assistLedger 的當量記給各提供者。
 * 冪等性交由呼叫端（與 damageMap 同一結算路徑，天然一場一記）。
 *
 * 可選 quest 參數（賽季任務指標，2026-08-07）：{ questService, rounds, resistPct }
 *   wb_damage_total（累計對王傷害）/ wb_assist_total（提供者累計助攻當量）
 *   wb_survive_full（撐滿 15 回合未陣亡）/ wb_resist_ready（抗性 ≥30% 出戰）/ wb_fullresist（滿抗出戰）
 */
async function recordBattle({
  discordId,
  displayName = null,
  damage = 0,
  died = false,
  battleJobId = "",
  battleJobName = "",
  damageBySource = null,
  assistBySource = null,
  assistBySourceJob = null,
  stunPreventedDmg = 0,
  stunSourceId = null,
  quest = null,
}) {
  const db = await getMongoDb();
  const c = db.collection(COL);
  const now = new Date().toISOString();
  const ops = [];
  const self = String(discordId || "");
  const battleDamage = Math.max(0, Math.round(Number(damage) || 0));
  const battleJobKey = battleJobId ? safeJobKey(battleJobId) : null;
  if (self) {
    const inc = { k: battleDamage, d: died ? 1 : 0, wbBattles: 1 };
    const set = { updatedAt: now, ...(displayName ? { name: displayName } : {}) };
    if (battleJobKey) {
      inc[`jobStats.${battleJobKey}.k`] = battleDamage;
      inc[`jobStats.${battleJobKey}.d`] = died ? 1 : 0;
      inc[`jobStats.${battleJobKey}.battles`] = 1;
      set[`jobStats.${battleJobKey}.jobId`] = String(battleJobId);
      set[`jobStats.${battleJobKey}.jobName`] = String(battleJobName || battleJobId);
    }
    ops.push({
      updateOne: {
        filter: { playerId: self },
        update: {
          $inc: inc,
          $set: set,
        },
        upsert: true,
      },
    });
  }

  // 神射手掩護箭等「由隊友直接造成的傷害」記為提供者的 K，不可算在被支援的出戰者身上。
  // 提供者沒有親自入場，因此只增加 K，不增加 wbBattles／D。
  const sourceDamageTotals = new Map();
  for (const [srcId, rowRaw] of Object.entries(damageBySource || {})) {
    const id = String(srcId || "");
    const row = rowRaw && typeof rowRaw === "object" ? rowRaw : { amount: rowRaw };
    const amount = Math.max(0, Math.round(Number(row.amount) || 0));
    if (!id || id === self || amount <= 0) continue;
    const prev = sourceDamageTotals.get(id) || { amount: 0, jobId: "", jobName: "", displayName: "" };
    sourceDamageTotals.set(id, {
      amount: prev.amount + amount,
      jobId: String(row.jobId || prev.jobId || ""),
      jobName: String(row.jobName || prev.jobName || ""),
      displayName: String(row.displayName || prev.displayName || ""),
    });
  }
  for (const [id, row] of sourceDamageTotals) {
    const inc = { k: row.amount };
    const set = { updatedAt: now, ...(row.displayName ? { name: row.displayName } : {}) };
    if (row.jobId) {
      const jobKey = safeJobKey(row.jobId);
      inc[`jobStats.${jobKey}.k`] = row.amount;
      set[`jobStats.${jobKey}.jobId`] = row.jobId;
      set[`jobStats.${jobKey}.jobName`] = row.jobName || row.jobId;
    }
    ops.push({
      updateOne: {
        filter: { playerId: id },
        update: { $inc: inc, $set: set },
        upsert: true,
      },
    });
  }

  // 同一提供者可能同時有多種光環／區域機制；先彙總成一筆 $inc，避免同場多次更新互踩。
  const assistTotals = new Map();
  for (const [srcId, amt] of Object.entries(assistBySource || {})) {
    const id = String(srcId || "");
    const v = Math.max(0, Math.round(Number(amt) || 0));
    if (!id || id === self || v <= 0) continue;
    assistTotals.set(id, (assistTotals.get(id) || 0) + v);
  }
  // 舊呼叫端相容：新版控制助攻已直接放進 assistBySource，這裡只接尚未遷移的舊欄位。
  const legacyStunId = String(stunSourceId || "");
  const legacyStunValue = Math.max(0, Math.round(Number(stunPreventedDmg) || 0));
  if (legacyStunId && legacyStunId !== self && legacyStunValue > 0) {
    assistTotals.set(legacyStunId, (assistTotals.get(legacyStunId) || 0) + legacyStunValue);
  }

  for (const [id, total] of assistTotals) {
    const inc = { a: total };
    const set = { updatedAt: now };
    for (const [jobId, rowRaw] of Object.entries(assistBySourceJob?.[id] || {})) {
      const row = rowRaw && typeof rowRaw === "object" ? rowRaw : { amount: rowRaw };
      const amount = Math.max(0, Math.round(Number(row.amount) || 0));
      if (!(amount > 0)) continue;
      const jobKey = safeJobKey(jobId);
      inc[`jobStats.${jobKey}.a`] = (inc[`jobStats.${jobKey}.a`] || 0) + amount;
      set[`jobStats.${jobKey}.jobId`] = String(jobId);
      set[`jobStats.${jobKey}.jobName`] = String(row.jobName || jobId);
    }
    ops.push({
      updateOne: {
        filter: { playerId: id },
        update: { $inc: inc, $set: set },
        upsert: true,
      },
    });
  }
  if (ops.length) await c.bulkWrite(ops, { ordered: false });

  // ── 賽季任務指標（失敗不影響 KDA 記錄）──
  const qs = quest?.questService;
  if (qs && typeof qs.recordProgress === "function") {
    const _rp = (id, type, amt) => qs.recordProgress(id, type, amt).catch(() => {});
    const dmg = battleDamage;
    if (self && dmg > 0) _rp(self, "wb_damage_total", dmg);
    for (const [srcId, row] of sourceDamageTotals) {
      if (srcId && row.amount > 0) _rp(srcId, "wb_damage_total", row.amount);
    }
    if (self && Number(quest.rounds) >= 15 && !died) _rp(self, "wb_survive_full", 1);
    const pct = Number(quest.resistPct);
    if (self && pct >= 30) _rp(self, "wb_resist_ready", 1);
    if (self && pct >= 100) _rp(self, "wb_fullresist", 1);
    for (const [srcId, amt] of assistTotals) {
      if (srcId && srcId !== self && amt > 0) _rp(srcId, "wb_assist_total", amt);
    }
  }
}

/** 個人頁：K/A/D ＋ 係數 ＋ C ＋ KDA 值 */
async function getPlayerStats(discordId) {
  const db = await getMongoDb();
  const row = await db.collection(COL).findOne({ playerId: String(discordId || "") });
  const k = Number(row?.k) || 0, a = Number(row?.a) || 0, d = Number(row?.d) || 0, b = Number(row?.wbBattles) || 0;
  return {
    k, a, d, wbBattles: b,
    coef: Number(survivalCoef(d, b).toFixed(3)),
    c: Math.round(contributionScore(row || {})),
    kdaValue: Number(((k + a) / Math.max(1, d)).toFixed(1)),
    jobStats: row?.jobStats || {},
  };
}

/** 四個舞台（附錄C 六）：輸出王 K／助攻王 A／不倒王 最低死亡率（需最低場次）／MVP C */
async function getBoards({ limit = 10, minBattlesForIron = 10 } = {}) {
  const db = await getMongoDb();
  const excludedIds = await getLeaderboardExcludedPlayerIds();
  const rows = (await db.collection(COL).find({}).toArray())
    .filter((row) => !excludedIds.has(String(row.playerId || "")));
  const enrich = (r) => ({
    playerId: r.playerId, name: r.name || r.playerId,
    k: Number(r.k) || 0, a: Number(r.a) || 0, d: Number(r.d) || 0, wbBattles: Number(r.wbBattles) || 0,
    deathRate: (Number(r.wbBattles) || 0) > 0 ? (Number(r.d) || 0) / Number(r.wbBattles) : 0,
    coef: Number(survivalCoef(Number(r.d) || 0, Number(r.wbBattles) || 0).toFixed(3)),
    c: Math.round(contributionScore(r)),
  });
  const all = rows.map(enrich);
  return {
    topDamage: [...all].sort((x, y) => y.k - x.k).slice(0, limit),
    topAssist: [...all].filter((r) => r.a > 0).sort((x, y) => y.a - x.a).slice(0, limit),
    ironWall:  [...all].filter((r) => r.wbBattles >= minBattlesForIron).sort((x, y) => x.deathRate - y.deathRate || y.c - x.c).slice(0, limit),
    mvp:       [...all].sort((x, y) => y.c - x.c).slice(0, limit),
    aWeight: A_WEIGHT, exemptDeathRate: EXEMPT_DEATH_RATE, minBattlesForIron,
  };
}

module.exports = { recordBattle, getPlayerStats, getBoards, survivalCoef, contributionScore, A_WEIGHT, EXEMPT_DEATH_RATE };
