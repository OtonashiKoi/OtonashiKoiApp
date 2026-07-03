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
  }
};

function mergeDonationBuff(raw = {}) {
  return { ...DEFAULTS.donationBuff, ...(raw || {}) };
}

async function getConfig() {
  const db = await getMongoDb().catch(() => null);
  if (!db) return { donationBuff: { ...DEFAULTS.donationBuff } };
  const doc = await db.collection("serverEventConfig").findOne({ _id: "default" }).catch(() => null);
  return { donationBuff: mergeDonationBuff(doc?.donationBuff) };
}

async function saveConfig(patch = {}) {
  const db = await getMongoDb();
  const cur = await getConfig();
  const next = { donationBuff: { ...cur.donationBuff, ...(patch.donationBuff || {}) } };
  // 數值淨化
  const b = next.donationBuff;
  b.enabled = Boolean(b.enabled);
  b.announce = Boolean(b.announce);
  b.minTwd = Math.max(0, Number(b.minTwd) || 0);
  b.dropPct = Math.max(0, Number(b.dropPct) || 0);
  b.goldPct = Math.max(0, Number(b.goldPct) || 0);
  b.expPct = Math.max(0, Number(b.expPct) || 0);
  b.durationMinutes = Math.max(1, Number(b.durationMinutes) || 1);
  await db.collection("serverEventConfig").updateOne(
    { _id: "default" },
    { $set: { donationBuff: b, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
  return next;
}

module.exports = { getConfig, saveConfig, DEFAULTS };
