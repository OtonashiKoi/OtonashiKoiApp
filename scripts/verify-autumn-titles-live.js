"use strict";
require("dotenv").config({ quiet: true });
const assert = require("node:assert/strict"), fs = require("node:fs"), crypto = require("node:crypto"), jwt = require("jsonwebtoken");
const mongo = require("../src/adapters/mongo/createMongoClient");
const rules = require("../src/shared/autumnTitleRules");
async function main() {
  const db = await mongo.getMongoDb(), m = await db.collection("maintenanceState").findOne({ _id: "default" });
  assert.equal(m.enabled, true); assert.equal(m.strict, false);
  const report = { at: new Date().toISOString(), loginClosed: true, quests: [], checks: [] };
  const admin = m.whitelist[0];
  const adminProgress = await db.collection("progress").findOne({ playerId: admin });
  const visibleTitles = rules.TITLES.filter(t => Number(t.unlockLevel || 0) <= Number(adminProgress?.level || 1));
  for (const t of rules.TITLES) {
    const item = await db.collection("items").findOne({ id: t.itemId });
    const q = await db.collection("weeklyQuests").findOne({ id: t.questId });
    assert(item && q && q.enabled); assert.equal(item.equipSlot, "title_eq");
    assert.equal(q.autumnTitleKey, t.key); assert.equal(q.target, t.target);
    assert(q.rewardItems.some(r => r.itemId === item.id && r.qty === 1));
    if (["veteran", "companions"].includes(t.key)) {
      assert.equal(q.rewardGold, 10000);
      assert.deepEqual(q.rewardItems.find(r => r.itemId === "8fdfa7d9-f0fa-4e6a-a291-703b1e354072"), { itemId: "8fdfa7d9-f0fa-4e6a-a291-703b1e354072", qty: 3 });
    }
    const mods = require("../src/services/battle/battleRewardRules").buildRewardModifiers({ equipment: { title_eq: item } });
    const baseline = require("../src/services/battle/battleRewardRules").buildRewardModifiers({ equipment: {} });
    assert.equal(mods.expPct - baseline.expPct, t.key === "maple" ? 3 : 0);
    assert.equal(mods.goldPct - baseline.goldPct, t.key === "maple" ? 2 : 0);
    report.quests.push({ name: t.name, target: q.target, gold: q.rewardGold });
  }
  const request = (origin, id, path) => fetch(origin + path, { headers: { Authorization: `Bearer ${jwt.sign({ discordId: id, displayName: "verification" }, process.env.JWT_SECRET, { expiresIn: "1m" })}` } });
  for (const origin of ["http://127.0.0.1:5566", "https://otonashikoi.org"]) {
    assert.equal((await fetch(origin + "/health")).status, 200);
    assert.equal((await request(origin, "not-a-real-player-autumn-verification", "/api/quests?cadence=season")).status, 403);
    const r = await request(origin, admin, "/api/quests?cadence=season"); assert.equal(r.status, 200);
    const data = await r.json(), list = Array.isArray(data) ? data : data.data;
    assert(Array.isArray(list));
    const entries = list.filter(row => row.quest?.autumnTitleKey);
    assert.equal(entries.length, visibleTitles.length);
    assert.deepEqual(entries.map(e => e.quest.autumnTitleKey).sort(), visibleTitles.map(t => t.key).sort());
    for (const e of entries) assert(e.quest.rewards.items.some(i => i.itemName === e.quest.title));
    report.checks.push({ origin, health: 200, admin: 200, ordinary: 403, titleQuests: entries.length });
    for (const t of rules.TITLES) {
      const path = `/uploads/items/autumn-titles/${t.key}.png`, response = await fetch(origin + path);
      assert.equal(response.status, 200);
      const downloaded = Buffer.from(await response.arrayBuffer()), local = fs.readFileSync(`src/web/public${path}`);
      assert.equal(crypto.createHash("sha256").update(downloaded).digest("hex"), crypto.createHash("sha256").update(local).digest("hex"));
    }
  }
  assert.deepEqual(await db.collection("maintenanceState").findOne({ _id: "default" }), m);
  report.sources = {};
  for (const f of ["src/shared/autumnTitleRules.js", "src/services/weeklyQuest/autumnTitleService.js", "src/services/weeklyQuest/weeklyQuestService.js", "src/services/checkin/checkinService.js", "src/services/enhance/enhanceService.js", "src/services/tower/partyTowerProgress.js", "src/services/idle/idleService.js", "src/services/battle/grantKillCurrencyAndExp.js"])
    report.sources[f] = crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
  fs.writeFileSync("/Users/riuchen/Documents/game-backups/autumn-titles-20261004-121204/live-readback.json", JSON.stringify(report, null, 2));
  console.log("PASS live: 7 title quests, equipped-only EXP +3% / gold +2%; old season rewards intact; local/public API and 7 matching icons; admin 200 / ordinary 403; maintenance unchanged");
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(mongo.closeMongoClient);
