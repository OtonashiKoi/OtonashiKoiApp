// 直播連動事件設定（門檻/效果可後台調，不寫死在程式）
// doc: serverEventConfig / _id:"default"
//
// 三線：
//   1) donationTiers — 斗內即時分級 buff（短期，模式A疊加，每類型上限 shortTermCapPct）
//   2) scBar         — 斗內賽季累積里程碑（賽季永久底盤）
//   3) memberEvents  — 會員短期慶祝 + 賽季永久里程碑
const { getMongoDb } = require("../../adapters/mongo/createMongoClient");

const DEFAULTS = {
  shortTermCapPct: 30, // 短期斗內尖峰每類型加成上限（賽季永久底盤不受此限）

  // 1) 斗內即時分級 buff（短期）：挑「minTwd 不超過金額」的最高一級觸發
  donationTiers: {
    enabled: false,
    announce: true,
    tiers: [
      { minTwd: 30, label: "金幣加成", goldPct: 10, dropPct: 0, expPct: 0, durationMinutes: 60 },
      { minTwd: 100, label: "掉寶加成", goldPct: 0, dropPct: 15, expPct: 0, durationMinutes: 60 },
      { minTwd: 300, label: "金幣＋掉寶", goldPct: 15, dropPct: 15, expPct: 0, durationMinutes: 60 },
      { minTwd: 500, label: "全服狂歡", goldPct: 20, dropPct: 20, expPct: 20, durationMinutes: 90 },
    ],
  },

  // 2) 斗內賽季累積里程碑（達標→賽季永久、疊加保留；數值＝該階「新增」多少，換季清空重來）
  scBar: {
    enabled: false,
    announce: true,
    milestones: [
      { id: "sc1", threshold: 3000, label: "SC獎勵 I", goldPct: 5, dropPct: 0, expPct: 0 },
      { id: "sc2", threshold: 5000, label: "SC獎勵 II", goldPct: 0, dropPct: 0, expPct: 5 },
      { id: "sc3", threshold: 10000, label: "SC獎勵 III", goldPct: 5, dropPct: 0, expPct: 0 },
      { id: "sc4", threshold: 15000, label: "SC獎勵 IV", goldPct: 0, dropPct: 5, expPct: 5 },
      { id: "sc5", threshold: 20000, label: "SC獎勵 V", goldPct: 5, dropPct: 5, expPct: 0 },
    ],
  },

  // 4) 觀看人數即時觸發（短期）：同時觀看數跨門檻→發全服 buff（單一、覆寫升級、不疊加）
  viewerTiers: {
    enabled: false,
    announce: true,
    streamUrl: "", // 廣播時附上的直播連結（每場可換；建議用 頻道/live 永久轉址）
    graceMinutes: 60, // 直播中持續有效；直播結束後再維持幾分鐘才消失
    announceCooldownMinutes: 60, // 遊戲區觀看人數提示的最短間隔（同場同階仍只發一次）
    tiers: [
      { minViewers: 30, label: "觀看熱度 I", goldPct: 5, dropPct: 5, expPct: 5, durationMinutes: 30 },
      { minViewers: 50, label: "觀看熱度 II", goldPct: 10, dropPct: 10, expPct: 10, durationMinutes: 30 },
    ],
  },

  // 3) 會員事件
  memberEvents: {
    enabled: false,
    announce: true,
    // 短期慶祝：會員數每突破 everyN 的倍數（新高）觸發一次
    shortBuff: { everyN: 5, label: "新會員慶祝", goldPct: 0, dropPct: 10, expPct: 0, durationMinutes: 30 },
    // 賽季永久里程碑（疊加式：數值＝該階「新增」多少，永久保留、換季清）
    milestones: [
      { id: "mem25", count: 25, label: "會員獎勵 I", goldPct: 3, dropPct: 0, expPct: 0 },
      { id: "mem50", count: 50, label: "會員獎勵 II", goldPct: 0, dropPct: 3, expPct: 0 },
      { id: "mem100", count: 100, label: "會員獎勵 III", goldPct: 0, dropPct: 0, expPct: 3 },
      { id: "mem200", count: 200, label: "會員獎勵 IV", goldPct: 2, dropPct: 2, expPct: 2 },
    ],
  },
};

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const pct = (v) => Math.max(0, num(v, 0));

// 分級（斗內即時）：依 minTwd 排序
function sanitizeTiers(list) {
  const src = Array.isArray(list) ? list : DEFAULTS.donationTiers.tiers;
  return src
    .map((t) => ({
      minTwd: Math.max(0, num(t?.minTwd, 0)),
      label: String(t?.label || ""),
      goldPct: pct(t?.goldPct), dropPct: pct(t?.dropPct), expPct: pct(t?.expPct),
      durationMinutes: Math.max(1, num(t?.durationMinutes, 60)),
    }))
    .filter((t) => t.goldPct > 0 || t.dropPct > 0 || t.expPct > 0)
    .sort((a, b) => a.minTwd - b.minTwd);
}

// 里程碑（SC 累積 / 會員），賽季永久：門檻欄位名 keyField（threshold 或 count）
function sanitizeMilestones(list, keyField, fallback) {
  const src = Array.isArray(list) ? list : fallback;
  return src
    .map((m, i) => ({
      id: String(m?.id || `${keyField}${i + 1}`),
      [keyField]: Math.max(0, num(m?.[keyField], 0)),
      label: String(m?.label || ""),
      goldPct: pct(m?.goldPct), dropPct: pct(m?.dropPct), expPct: pct(m?.expPct),
    }))
    .filter((m) => m[keyField] > 0)
    .sort((a, b) => a[keyField] - b[keyField]);
}

function mergeDonationTiers(raw) {
  const base = { ...DEFAULTS.donationTiers, ...(raw || {}) };
  base.enabled = Boolean(base.enabled);
  base.announce = base.announce !== false;
  base.tiers = raw && raw.tiers !== undefined ? sanitizeTiers(raw.tiers) : DEFAULTS.donationTiers.tiers.map((t) => ({ ...t }));
  return base;
}
function mergeScBar(raw) {
  const base = { ...DEFAULTS.scBar, ...(raw || {}) };
  base.enabled = Boolean(base.enabled);
  base.announce = base.announce !== false;
  base.milestones = raw && raw.milestones !== undefined
    ? sanitizeMilestones(raw.milestones, "threshold", DEFAULTS.scBar.milestones)
    : DEFAULTS.scBar.milestones.map((m) => ({ ...m }));
  return base;
}
function sanitizeViewerTiers(list) {
  const src = Array.isArray(list) ? list : DEFAULTS.viewerTiers.tiers;
  return src
    .map((t) => ({
      minViewers: Math.max(1, num(t?.minViewers, 0)),
      label: String(t?.label || ""),
      goldPct: pct(t?.goldPct), dropPct: pct(t?.dropPct), expPct: pct(t?.expPct),
      durationMinutes: Math.max(1, num(t?.durationMinutes, 30)),
    }))
    .filter((t) => t.minViewers > 0 && (t.goldPct > 0 || t.dropPct > 0 || t.expPct > 0))
    .sort((a, b) => a.minViewers - b.minViewers);
}
function mergeViewerTiers(raw) {
  const base = { ...DEFAULTS.viewerTiers, ...(raw || {}) };
  base.enabled = Boolean(base.enabled);
  base.announce = base.announce !== false;
  base.streamUrl = String(base.streamUrl || "").trim().slice(0, 300);
  base.graceMinutes = Math.max(1, num(base.graceMinutes, 60));
  base.announceCooldownMinutes = Math.min(1440, Math.max(5, num(base.announceCooldownMinutes, 60)));
  base.tiers = raw && raw.tiers !== undefined ? sanitizeViewerTiers(raw.tiers) : DEFAULTS.viewerTiers.tiers.map((t) => ({ ...t }));
  return base;
}
function mergeMemberEvents(raw) {
  const base = { ...DEFAULTS.memberEvents, ...(raw || {}) };
  base.enabled = Boolean(base.enabled);
  base.announce = base.announce !== false;
  const sb = { ...DEFAULTS.memberEvents.shortBuff, ...(raw?.shortBuff || {}) };
  base.shortBuff = {
    everyN: Math.max(1, num(sb.everyN, 5)), label: String(sb.label || "新會員慶祝"),
    goldPct: pct(sb.goldPct), dropPct: pct(sb.dropPct), expPct: pct(sb.expPct),
    durationMinutes: Math.max(1, num(sb.durationMinutes, 30)),
  };
  base.milestones = raw && raw.milestones !== undefined
    ? sanitizeMilestones(raw.milestones, "count", DEFAULTS.memberEvents.milestones)
    : DEFAULTS.memberEvents.milestones.map((m) => ({ ...m }));
  return base;
}

async function getConfig() {
  const db = await getMongoDb().catch(() => null);
  const doc = db ? await db.collection("serverEventConfig").findOne({ _id: "default" }).catch(() => null) : null;
  return {
    shortTermCapPct: Math.max(1, num(doc?.shortTermCapPct, DEFAULTS.shortTermCapPct)),
    donationTiers: mergeDonationTiers(doc?.donationTiers),
    scBar: mergeScBar(doc?.scBar),
    memberEvents: mergeMemberEvents(doc?.memberEvents),
    viewerTiers: mergeViewerTiers(doc?.viewerTiers),
  };
}

async function saveConfig(patch = {}) {
  const db = await getMongoDb();
  const cur = await getConfig();
  const set = { updatedAt: new Date().toISOString() };
  if (patch.shortTermCapPct !== undefined) set.shortTermCapPct = Math.max(1, num(patch.shortTermCapPct, cur.shortTermCapPct));
  if (patch.donationTiers !== undefined) set.donationTiers = mergeDonationTiers({ ...cur.donationTiers, ...(patch.donationTiers || {}) });
  if (patch.scBar !== undefined) set.scBar = mergeScBar({ ...cur.scBar, ...(patch.scBar || {}) });
  if (patch.memberEvents !== undefined) set.memberEvents = mergeMemberEvents({ ...cur.memberEvents, ...(patch.memberEvents || {}) });
  if (patch.viewerTiers !== undefined) set.viewerTiers = mergeViewerTiers({ ...cur.viewerTiers, ...(patch.viewerTiers || {}) });
  await db.collection("serverEventConfig").updateOne({ _id: "default" }, { $set: set }, { upsert: true });
  const next = await getConfig();
  await syncRuntimeConfig(next); // 讓引擎的短期上限即時跟上
  return next;
}

// 把 config 的 runtime 值（目前只有短期上限）注入 globalBuffService。init + saveConfig 都呼叫。
async function syncRuntimeConfig(cfg) {
  try {
    const c = cfg || (await getConfig());
    require("./globalBuffService").setShortTermCapPct(c.shortTermCapPct);
  } catch (_) { /* noop */ }
}

module.exports = { getConfig, saveConfig, syncRuntimeConfig, DEFAULTS };
