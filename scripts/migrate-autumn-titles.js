"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const { BSON } = require("mongodb");
const { TITLES, SEASON_KEY } = require("../src/shared/autumnTitleRules");
const descriptions = {
  traveler: "本季累積擊敗怪物 100 次。",
  veteran: "本季累積擊敗怪物 3,000 次。",
  attendance: "本季於 15 個不同日期完成報到；不需連續，同日跨平台只計一次。",
  forge: "本季親自成功將 3 件不同的 A 級裝備強化至 +5；交易取得或同件重複強化不計。",
  companions: "本季累積通關組隊副本 100 樓；一般與挑戰皆可，已通關樓層即計入。",
  summit: "完整通關一次挑戰難度 50 樓；中途離隊或分次累積不計。",
  maple: "領取本季前六個稱號中的任意四個。裝備後經驗值 +3%、金幣 +2%。"
};
function titleItems() {
  return TITLES.map(t => ({ id: t.itemId, name: t.name, description: descriptions[t.key],
    itemType: "equipment", equipSlot: "title_eq", tier: null, seasonPersistent: true,
    effect: { type: "none", value: 0 }, equipStats: {}, useEffects: [], procEffects: [], combatEffects: [],
    passiveEffects: t.key === "maple" ? [
      { key: "exp_gain_up", target: "self", params: { value: 3 } },
      { key: "gold_gain_up", target: "self", params: { value: 2 } }
    ] : [],
    imageUrl: `https://otonashikoi.org/uploads/items/autumn-titles/${t.key}.png`,
    imageThumbnailUrl: `https://otonashikoi.org/uploads/items/autumn-titles/${t.key}.png`
  }));
}
const BONUS_REWARDS = {
  traveler: { gold: 1000, tier: "D", qty: 2 }, veteran: { gold: 10000, tier: "B", qty: 3 },
  attendance: { gold: 3000, tier: "C", qty: 2 }, forge: { gold: 5000, tier: "A", qty: 2 },
  companions: { gold: 10000, tier: "B", qty: 3 }, summit: { gold: 10000, tier: "A", qty: 3 },
  maple: { gold: 5000, tier: "B", qty: 2 }
};
function questPatch(t, existing = null) {
  const base = existing || { id: t.questId, cadence: "season", enabled: true, groupKey: "autumn_202610_v1",
    resetPolicy: "once", claimOnce: true, hideIfRewardOwned: false, rewardGold: 0, rewardExp: 0,
    rewardDiamond: 0, rewardItems: [], levelLimit: 0, unlockLevel: t.unlockLevel || 0 };
  const bonus = BONUS_REWARDS[t.key];
  const gems = require("../src/shared/enhanceConfig").ENHANCE_GEMS;
  // 每種稱號與配套強化石只列一次；不因重跑增加獎勵。
  const extra = (base.rewardItems || []).filter(r => r.itemId !== t.itemId && !Object.values(gems).includes(r.itemId));
  return { ...base, title: t.name, description: descriptions[t.key], type: t.type, target: t.target,
    autumnTitleKey: t.key, autumnTitleSeason: SEASON_KEY, sortOrder: 100 + TITLES.indexOf(t) * 10,
    rewardGold: bonus.gold, rewardItemId: t.itemId,
    rewardItems: [...extra, { itemId: gems[bonus.tier], qty: bonus.qty }, { itemId: t.itemId, qty: 1 }] };
}
function parseBackup(path) {
  const bytes = fs.readFileSync(path), documents = [];
  for (let offset = 0; offset < bytes.length;) {
    const length = bytes.readInt32LE(offset); assert(length >= 5 && offset + length <= bytes.length);
    documents.push(BSON.deserialize(bytes.subarray(offset, offset + length))); offset += length;
  }
  return { documents, hash: crypto.createHash("sha256").update(bytes).digest("hex") };
}
async function migrate(db, { apply = false, backup } = {}) {
  const old = await db.collection("weeklyQuests").find({ id: { $in: TITLES.map(t => t.questId) } }).toArray();
  const existing = new Map(old.map(q => [q.id, q]));
  for (const key of ["veteran", "companions"]) assert(existing.has(TITLES.find(t => t.key === key).questId), "existing season reward missing");
  const quests = TITLES.map(t => questPatch(t, existing.get(t.questId))), items = titleItems();
  for (const q of quests) for (const r of q.rewardItems) assert(items.some(i => i.id === r.itemId) || await db.collection("items").findOne({ id: r.itemId }), "reward item missing");
  if (!apply) return { items, quests, apply };
  const manifest = JSON.parse(fs.readFileSync(`${backup}/manifest.json`));
  for (const name of ["items", "weeklyQuests", "maintenanceState", "gameSeasonState"]) {
    const parsed = parseBackup(`${backup}/${name}.bson`), entry = manifest.find(e => e.name === name);
    assert(entry && parsed.documents.length === entry.count && parsed.hash === entry.sha256, "backup integrity mismatch");
    if (name === "weeklyQuests") for (const q of old) assert.deepEqual(q, parsed.documents.find(x => x.id === q.id), "quest changed since backup; back up again");
  }
  const maintenance = await db.collection("maintenanceState").findOne({ _id: "default" });
  assert.equal(maintenance?.enabled, true, "retain closed player login during deployment");
  const now = new Date().toISOString();
  for (const item of items) {
    assert(!await db.collection("items").findOne({ id: item.id }), "title already exists; inspect before reapplying");
    await db.collection("items").insertOne({ ...item, createdAt: now, updatedAt: now });
  }
  for (const q of quests) {
    const { _id, ...fields } = q;
    if (_id) {
      const result = await db.collection("weeklyQuests").updateOne({ _id, updatedAt: q.updatedAt }, { $set: { ...fields, updatedAt: now } });
      assert.equal(result.matchedCount, 1, "quest CAS conflict");
    } else await db.collection("weeklyQuests").insertOne({ ...fields, createdAt: now, updatedAt: now });
  }
  for (const item of items) {
    const saved = await db.collection("items").findOne({ id: item.id });
    for (const [k, v] of Object.entries(item)) assert.deepEqual(saved[k], v);
  }
  for (const q of quests) {
    const saved = await db.collection("weeklyQuests").findOne({ id: q.id });
    for (const [k, v] of Object.entries(q)) if (!["_id", "updatedAt"].includes(k)) assert.deepEqual(saved[k], v);
  }
  assert.deepEqual(await db.collection("maintenanceState").findOne({ _id: "default" }), maintenance);
  return { verifiedItems: items.length, verifiedQuests: quests.length, loginClosed: true };
}
if (require.main === module) {
  require("dotenv").config({ quiet: true });
  const mongo = require("../src/adapters/mongo/createMongoClient");
  mongo.getMongoDb().then(db => migrate(db, { apply: process.argv.includes("--apply"), backup: process.argv.find(a => a.startsWith("--backup="))?.slice(9) }))
    .then(result => console.log(JSON.stringify(result))).catch(e => { console.error(e); process.exitCode = 1; }).finally(mongo.closeMongoClient);
}
module.exports = { titleItems, questPatch, migrate };
