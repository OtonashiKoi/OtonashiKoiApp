"use strict";

// Narrow migration: add the approved shield and its drop without rewriting the
// live monster, boss configuration, or an active fight.
require("dotenv").config();
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { EJSON } = require("bson");
const { getMongoDb, closeMongoClient } = require("../src/adapters/mongo/createMongoClient");
const { HUTAO_SHIELD, HUTAO_S_EQUIPMENT, buildItem } = require("./upsert-event-hutao-preview");

const apply = process.argv.includes("--apply");
const backupDir = process.argv.find((arg) => arg.startsWith("--backup-dir="))?.slice(13);
const expectedDb = process.argv.find((arg) => arg.startsWith("--expect-db="))?.slice(12);
if (apply && (!backupDir || !expectedDb)) throw new Error("--apply requires --backup-dir=<repository外目錄> and --expect-db=<資料庫名稱>");
if (apply && path.resolve(backupDir).startsWith(path.resolve(__dirname, "..") + path.sep))
  throw new Error("備份目錄必須在 repository 外");

async function main() {
  const db = await getMongoDb();
  if (apply) assert.equal(db.databaseName, expectedDb, "資料庫名稱不符；停止寫入");
  const items = db.collection("items");
  const monsters = db.collection("monsters");
  const id = HUTAO_SHIELD.id;
  const [previousItems, monster] = await Promise.all([
    items.find({ id: { $in: HUTAO_S_EQUIPMENT.map((spec) => spec.id) } }).toArray(),
    monsters.findOne({ id: "event-northwind-hutao" }),
  ]);
  const byId = new Map(previousItems.map((entry) => [entry.id, entry]));
  const previousItem = byId.get(id);
  assert.ok(monster, "胡桃怪物定義不存在");
  assert.ok(Array.isArray(monster.drops), "胡桃掉落表不存在");
  assert.equal(previousItems.length, previousItem ? 14 : 13, "胡桃現有 S 裝數量不符");
  const oldDrop = monster.drops.find((drop) => drop.itemId === id);
  const item = buildItem(HUTAO_SHIELD, new Date().toISOString());
  assert.equal(item.equipSlot, "shield");
  assert.equal(item.weaponType, null);
  assert.equal(item.setKey, "northwind_hutao");
  const updates = [];
  for (const spec of HUTAO_S_EQUIPMENT) {
    const old = byId.get(spec.id);
    if (!old) { assert.equal(spec.id, id); continue; }
    const target = buildItem(spec, old.updatedAt);
    const oldDescription = target.description.split("\n【北風套裝・大四喜】")[0];
    assert.ok(old.description === oldDescription || old.description === target.description, `${spec.id} 說明有未預期修改`);
    assert.ok(old.setKey == null || old.setKey === target.setKey, `${spec.id} 套裝歸屬衝突`);
    assert.ok(!old.setKeys?.length || (old.setKeys.length === 1 && old.setKeys[0] === target.setKey), `${spec.id} 複合套裝歸屬衝突`);
    if (old.description !== target.description || old.setKey !== target.setKey || old.setName !== target.setName || JSON.stringify(old.setKeys) !== JSON.stringify(target.setKeys))
      updates.push({ old, target });
  }
  if (previousItem) {
    for (const key of ["name", "tier", "equipSlot", "weaponType", "isTwoHanded", "equipStats", "passiveEffects", "setKey", "setKeys", "imageUrl"])
      assert.deepEqual(previousItem[key], item[key], `既有盾牌 ${key} 不符；停止覆寫`);
  }
  if (oldDrop) assert.deepEqual(oldDrop, { itemId: id, itemName: item.name, chance: 5 }, "既有掉落設定不符；停止覆寫");
  console.log(JSON.stringify({ item: id, exists: !!previousItem, dropExists: !!oldDrop, setMetadataUpdates: updates.length, apply }, null, 2));
  if (!apply) return;

  await fs.mkdir(backupDir, { recursive: true });
  await fs.writeFile(path.join(backupDir, `hutao-shield-before-${randomUUID()}.ejson`),
    EJSON.stringify({ items: previousItems, monster }, null, 2), { flag: "wx" });
  for (const { old, target } of updates) {
    const result = await items.updateOne({ _id: old._id, setKey: old.setKey, setKeys: old.setKeys, description: old.description },
      { $set: { setKey: target.setKey, setKeys: target.setKeys, setName: target.setName, description: target.description } });
    assert.equal(result.modifiedCount, 1, `${old.id} 並發變更；請重新讀回`);
  }
  if (!previousItem) await items.insertOne({ ...item, createdAt: item.updatedAt });
  if (!oldDrop) {
    const result = await monsters.updateOne(
      { _id: monster._id, drops: { $not: { $elemMatch: { itemId: id } } } },
      { $push: { drops: { itemId: id, itemName: item.name, chance: 5 } } }
    );
    assert.equal(result.modifiedCount, 1, "掉落表並發變更；請重新讀回");
  }
  const [savedItems, savedMonster] = await Promise.all([
    items.find({ id: { $in: HUTAO_S_EQUIPMENT.map((spec) => spec.id) } }).toArray(),
    monsters.findOne({ _id: monster._id }),
  ]);
  const savedItem = savedItems.find((entry) => entry.id === id);
  assert.equal(savedItems.length, 14);
  for (const saved of savedItems) assert.equal(saved.setKey, "northwind_hutao");
  assert.deepEqual(savedItem.equipStats, item.equipStats);
  assert.equal(savedMonster.drops.filter((drop) => drop.itemId === id).length, 1);
  console.log("胡桃 14 件 S 裝套裝歸屬、盾牌與 5% 掉落已讀回；其他怪物欄位未寫入。");
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(closeMongoClient);
module.exports = { main };
