"use strict";

require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const APPLY = process.argv.includes("--apply");
const ELEMENT_STONE_IDS = new Set(
  ["water", "fire", "wood", "earth", "metal", "sun", "moon"].map((element) => `element-stone-${element}`)
);

function stackCountOf(entry) {
  return Math.max(1, Math.trunc(Number(entry?.stackCount) || 1));
}

function mergeElementStoneStacks(inventory) {
  if (!Array.isArray(inventory)) return { inventory: [], changed: false, removedEntries: 0 };
  const output = [];
  const firstById = new Map();
  let removedEntries = 0;
  for (const entry of inventory) {
    const itemId = String(entry?.itemId || "");
    if (!entry || !ELEMENT_STONE_IDS.has(itemId)) { output.push(entry); continue; }
    const first = firstById.get(itemId);
    if (!first) {
      const normalized = { ...entry, stackCount: stackCountOf(entry) };
      firstById.set(itemId, normalized);
      output.push(normalized);
      continue;
    }
    first.stackCount += stackCountOf(entry);
    removedEntries += 1;
  }
  return { inventory: output, changed: removedEntries > 0, removedEntries };
}

async function run() {
  const db = await getMongoDb();
  const collection = db.collection("progress");
  const candidates = await collection.find(
    { "inventory.itemId": { $in: [...ELEMENT_STONE_IDS] } },
    { projection: { _id: 1 } }
  ).toArray();
  let affectedPlayers = 0, removedEntries = 0, beforeQuantity = 0, afterQuantity = 0;
  for (const candidate of candidates) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await collection.findOne({ _id: candidate._id }, { projection: { inventory: 1, updatedAt: 1 } });
      if (!current) break;
      const merged = mergeElementStoneStacks(current.inventory);
      if (!merged.changed) break;
      const countStones = (rows) => rows.filter((entry) => ELEMENT_STONE_IDS.has(String(entry?.itemId || "")))
        .reduce((sum, entry) => sum + stackCountOf(entry), 0);
      const before = countStones(current.inventory), after = countStones(merged.inventory);
      if (!APPLY) {
        affectedPlayers += 1; removedEntries += merged.removedEntries;
        beforeQuantity += before; afterQuantity += after;
        break;
      }
      const versionFilter = current.updatedAt === undefined
        ? { _id: candidate._id, updatedAt: { $exists: false } }
        : { _id: candidate._id, updatedAt: current.updatedAt };
      const result = await collection.updateOne(versionFilter, {
        $set: { inventory: merged.inventory, updatedAt: new Date().toISOString() }
      });
      if (result.modifiedCount > 0) {
        affectedPlayers += 1; removedEntries += merged.removedEntries;
        beforeQuantity += before; afterQuantity += after;
        break;
      }
    }
  }
  if (beforeQuantity !== afterQuantity) throw new Error(`屬性石總數不一致：${beforeQuantity} -> ${afterQuantity}`);
  console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", affectedPlayers, removedEntries, beforeQuantity, afterQuantity }, null, 2));
}

if (require.main === module) run().then(() => process.exit(0)).catch((error) => {
  console.error(error.message);
  process.exit(1);
});

module.exports = { ELEMENT_STONE_IDS, mergeElementStoneStacks };
