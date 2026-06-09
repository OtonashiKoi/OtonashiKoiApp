"use strict";
/**
 * 移除全服「來源為 tower_drop 的 S 階裝備」(塔掉出來的 S 直接回收)，先備份。
 * 世界王掉的(monster_drop / monster_drop_bonus / world_boss_chest 等)一律保留。
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

(async () => {
  const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
  const db = await getMongoDb();
  const sItems = await db.collection("items").find({ tier: "S", itemType: "equipment" }).toArray();
  const sEquipIds = new Set(sItems.map((it) => it.id));
  const nameById = {}; for (const it of sItems) nameById[it.id] = it.name;

  const progs = await db.collection("progress").find({}).toArray();
  const removed = [];
  for (const p of progs) {
    const inv = Array.isArray(p.inventory) ? p.inventory : [];
    const toPull = inv.filter((e) => e && sEquipIds.has(e.itemId) && e.source === "tower_drop");
    if (!toPull.length) continue;
    for (const e of toPull) removed.push({ playerId: p.playerId, uuid: e.uuid, itemId: e.itemId, name: nameById[e.itemId] || e.itemId, source: e.source, sourceRef: e.sourceRef });
  }

  if (!removed.length) { console.log("沒有任何 source=tower_drop 的 S 階裝備,無需移除。"); process.exit(0); }

  // 備份
  const backupDir = path.join(__dirname, "..", "backups");
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `tower-s-equipment-removed-${ts}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(removed, null, 2));
  console.log(`已備份 ${removed.length} 件 → ${backupPath}\n`);

  // 逐件以 uuid 精準移除
  for (const r of removed) {
    const res = await db.collection("progress").updateOne(
      { playerId: r.playerId },
      { $pull: { inventory: { uuid: r.uuid } }, $set: { updatedAt: new Date().toISOString() } }
    );
    console.log(`  移除 ${r.name}（${r.playerId}，來源 ${r.source}/${r.sourceRef}）→ ${res.modifiedCount ? "✅" : "❌未變更"}`);
  }

  // 驗證
  const left = [];
  for (const p of await db.collection("progress").find({}).project({ playerId: 1, inventory: 1 }).toArray()) {
    for (const e of (p.inventory || [])) if (e && sEquipIds.has(e.itemId) && e.source === "tower_drop") left.push(`${p.playerId}:${e.itemId}`);
  }
  console.log(`\n驗證:殘留 tower_drop S 裝備 = ${left.length}${left.length ? " (" + left.join(",") + ")" : " ✅"}`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
