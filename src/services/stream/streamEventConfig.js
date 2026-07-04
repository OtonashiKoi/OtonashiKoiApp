// 直播連動事件設定（門檻/效果可後台調，不寫死在程式）
// doc: serverEventConfig / _id:"default"
const { getMongoDb } = require("../../adapters/mongo/createMongoClient");

const DEFAULTS = {
  // 斗內觸發全服 Buff 規則
  donationBuff: {
    enabled: false,        // 預設關：功能已就緒，你填好數字後在後台開啟即生效
    minTwd: 300,           // 單筆斗內 ≥ 此金額才觸發（示意值，可改）
    dropPct: 20,           // 掉寶加成 %
    goldPct: 0,            // 金幣加成 %
    expPct: 0,             // 經驗加成 %
    durationMinutes: 60,   // 持續分鐘
    announce: true         // 觸發時是否全服廣播
  },
  // SC 累積條：全服斗內累積 → 跨里程碑解鎖
  scBar: {
    enabled: false,        // 預設關：累積條照樣累積+顯示，但里程碑獎勵不發（獎勵之後再定）
    // 里程碑（threshold=累積台幣門檻；效果目前用全服 buff，之後可改）
    milestones: [
      { id: "m1", threshold: 1000, label: "全服金幣加成", dropPct: 0, goldPct: 10, expPct: 0, durationMinutes: 60, announce: true },
      { id: "m2", threshold: 3000, label: "全服掉寶加成", dropPct: 30, goldPct: 0, expPct: 0, durationMinutes: 60, announce: true },
      { id: "m3", threshold: 5000, label: "全服狂歡", dropPct: 30, goldPct: 30, expPct: 30, durationMinutes: 90, announce: true }
    ]
  }
};

function mergeDonationBuff(raw = {}) {
  return { ...DEFAULTS.donationBuff, ...(raw || {}) };
}

function sanitizeMilestones(list) {
  if (!Array.isArray(list)) return DEFAULTS.scBar.milestones.map((m) => ({ ...m }));
  return list
    .map((m, i) => ({
      id: String(m?.id || `m${i + 1}`),
      threshold: Math.max(0, Number(m?.threshold) || 0),
      label: String(m?.label || ""),
      dropPct: Math.max(0, Number(m?.dropPct) || 0),
      goldPct: Math.max(0, Number(m?.goldPct) || 0),
      expPct: Math.max(0, Number(m?.expPct) || 0),
      durationMinutes: Math.max(1, Number(m?.durationMinutes) || 60),
      announce: m?.announce !== false
    }))
    .filter((m) => m.threshold > 0);
}

function mergeScBar(raw = {}) {
  const base = { ...DEFAULTS.scBar, ...(raw || {}) };
  base.milestones = raw && raw.milestones !== undefined
    ? sanitizeMilestones(raw.milestones)
    : DEFAULTS.scBar.milestones.map((m) => ({ ...m }));
  base.enabled = Boolean(base.enabled);
  return base;
}

async function getConfig() {
  const db = await getMongoDb().catch(() => null);
  if (!db) return { donationBuff: { ...DEFAULTS.donationBuff }, scBar: mergeScBar() };
  const doc = await db.collection("serverEventConfig").findOne({ _id: "default" }).catch(() => null);
  return { donationBuff: mergeDonationBuff(doc?.donationBuff), scBar: mergeScBar(doc?.scBar) };
}

async function saveConfig(patch = {}) {
  const db = await getMongoDb();
  const cur = await getConfig();
  const set = { updatedAt: new Date().toISOString() };

  if (patch.donationBuff !== undefined) {
    const b = { ...cur.donationBuff, ...(patch.donationBuff || {}) };
    b.enabled = Boolean(b.enabled);
    b.announce = Boolean(b.announce);
    b.minTwd = Math.max(0, Number(b.minTwd) || 0);
    b.dropPct = Math.max(0, Number(b.dropPct) || 0);
    b.goldPct = Math.max(0, Number(b.goldPct) || 0);
    b.expPct = Math.max(0, Number(b.expPct) || 0);
    b.durationMinutes = Math.max(1, Number(b.durationMinutes) || 1);
    set.donationBuff = b;
  }
  if (patch.scBar !== undefined) {
    set.scBar = mergeScBar({ ...cur.scBar, ...(patch.scBar || {}) });
  }

  await db.collection("serverEventConfig").updateOne({ _id: "default" }, { $set: set }, { upsert: true });
  return getConfig();
}

module.exports = { getConfig, saveConfig, DEFAULTS };
