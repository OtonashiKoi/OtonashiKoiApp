"use strict";
// 事故還原補遺 3：任務道具補發。
// 依 weeklyQuestProgress（KEEP_LEDGER 保留的領取紀錄）補發合法窗口內領過的任務道具
// （rewardItemId + rewardItems）。金幣/經驗已在前兩支腳本處理，這裡只發道具；已持有不重發。
// 用法：node scripts/incident-20260809-quest-items.js          # dry-run
//       APPLY=1 node scripts/incident-20260809-quest-items.js
require("dotenv").config();
const crypto = require("node:crypto");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const APPLY = process.env.APPLY === "1";
const OPEN = "2026-08-09T12:00:00.000Z";
const CLOBBER = "2026-08-09T12:31:39.000Z";

function entryFromDef(d) {
  return {
    uuid: crypto.randomUUID(), itemId: d.id, itemName: d.name,
    itemEffect: d.effect || { type: "none", value: 0 },
    useEffects: d.useEffects || [], passiveEffects: d.passiveEffects || [],
    procEffects: d.procEffects || [], combatEffects: d.combatEffects || [],
    itemType: d.itemType || "consumable", equipSlot: d.equipSlot || null,
    equipStats: d.equipStats ? { ...d.equipStats } : {},
    weaponType: d.weaponType || null, isTwoHanded: d.isTwoHanded || false,
    atkStat: d.atkStat || null, tier: d.tier || null,
    imageUrl: d.imageUrl || null, imageThumbnailUrl: d.imageThumbnailUrl || null,
    monsterCardSkill: d.monsterCardSkill || null, jobSkills: d.jobSkills || undefined,
    enhanceLevel: 0, source: "incident_restore_quest", sourceRef: "incident-20260809",
    obtainedAt: new Date().toISOString(),
  };
}

(async () => {
  const db = await getMongoDb();
  const defs = {}; (await db.collection("weeklyQuests").find({}).toArray()).forEach((q) => { defs[q.id] = q; });
  const items = {}; (await db.collection("items").find({}).toArray()).forEach((d) => { items[d.id] = d; });

  const wqp = await db.collection("weeklyQuestProgress").find({}).toArray();
  const plan = {}; // pid -> [{questTitle,itemId}]
  for (const row of wqp) {
    const pid = row.discordId || row.playerId; if (!pid) continue;
    const period = row.progress || row.quests || row;
    for (const [qid, st] of Object.entries(period)) {
      if (!st || typeof st !== "object" || !st.claimed) continue;
      const at = st.claimedAt || st.updatedAt || null;
      if (at && (at < OPEN || at >= CLOBBER)) continue;   // 只補合法窗口
      const def = defs[qid]; if (!def) continue;
      const ids = [];
      if (def.rewardItemId && def.type !== "t2_transfer") ids.push(String(def.rewardItemId));
      (def.rewardItems || []).forEach((x) => ids.push(String(x.itemId || x)));
      for (const iid of ids) {
        if (!items[iid]) { console.log(`⚠️ 任務「${def.title}」獎勵道具不存在: ${iid}`); continue; }
        (plan[pid] = plan[pid] || []).push({ quest: def.title, itemId: iid, itemName: items[iid].name });
      }
    }
  }

  console.log(`需補發玩家 ${Object.keys(plan).length} 名\n`);
  let granted = 0, skipped = 0;
  for (const [pid, list] of Object.entries(plan)) {
    const p = await db.collection("progress").findOne({ playerId: pid });
    if (!p) continue;
    const owned = new Set([
      ...(p.inventory || []).map((x) => String(x.itemId || "")),
      ...Object.values(p.equipment || {}).map((x) => String(x?.itemId || "")),
    ]);
    const pl = await db.collection("players").findOne({ discordId: pid }, { projection: { name: 1, nickname: 1 } });
    const name = String(pl?.nickname || pl?.name || pid).slice(0, 14);
    const toGrant = [], dup = [];
    for (const g of list) (owned.has(g.itemId) ? dup : toGrant).push(g);
    // 同一玩家同一道具只發一次（同任務不會重複領，但保險）
    const seen = new Set();
    const finalGrant = toGrant.filter((g) => !seen.has(g.itemId) && seen.add(g.itemId));
    console.log(name.padEnd(16) + `補 ${finalGrant.length} 件` + (dup.length ? `（略過已持有 ${dup.length}）` : "")
      + "：" + finalGrant.map((g) => g.itemName).join("、"));
    granted += finalGrant.length; skipped += dup.length;
    if (!APPLY || !finalGrant.length) continue;
    await db.collection("progress").updateOne(
      { playerId: pid },
      { $push: { inventory: { $each: finalGrant.map((g) => entryFromDef(items[g.itemId])) } },
        $set: { updatedAt: new Date().toISOString() } }
    );
  }
  console.log(`\n合計補發 ${granted} 件、略過已持有 ${skipped} 件`);
  console.log(APPLY ? "✅ 已寫入" : "🟡 DRY-RUN（加 APPLY=1 執行）");
  process.exit(0);
})().catch((e) => { console.error("❌", e); process.exit(1); });
