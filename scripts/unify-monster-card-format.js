require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const SPECIAL_SLOTS = ["special_1", "special_2", "special_3"];
const WRITE_ENABLED = process.argv.includes("--apply");
const BACKUP_ENABLED = !process.argv.includes("--no-backup");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getMongoConfig() {
  return {
    uri: process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://localhost:27017",
    dbName: process.env.MONGODB_DB || process.env.MONGODB_DB_NAME || process.env.MONGO_DB || "equipment_game"
  };
}

function normalizeName(value) {
  return String(value || "").trim();
}

function getItemKey(item) {
  return normalizeName(item.monsterCardOf) || normalizeName(item.name) || normalizeName(item.itemName);
}

function buildNewCardIndexes(newCards) {
  const byMonster = new Map();
  const byName = new Map();

  for (const card of newCards) {
    const monsterKey = normalizeName(card.monsterCardOf);
    const nameKey = normalizeName(card.name || card.itemName);
    if (monsterKey && !byMonster.has(monsterKey)) byMonster.set(monsterKey, card);
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, card);
  }

  return { byMonster, byName };
}

function findReplacement(oldCard, indexes) {
  const monsterKey = normalizeName(oldCard.monsterCardOf);
  const nameKey = normalizeName(oldCard.name || oldCard.itemName);
  return (monsterKey && indexes.byMonster.get(monsterKey))
    || (nameKey && indexes.byName.get(nameKey))
    || null;
}

function oldItemIdSet(oldCards) {
  const ids = new Set();
  for (const card of oldCards) {
    if (card.id) ids.add(String(card.id));
    if (card._id) ids.add(String(card._id));
  }
  return ids;
}

function isOldCardEntry(entry, oldIds) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.itemType === "monster_card") return true;
  const ids = [entry.itemId, entry.id, entry.itemLibraryId].filter(Boolean).map(String);
  return ids.some((id) => oldIds.has(id));
}

function dedupeDrops(drops) {
  const result = [];
  const seen = new Map();

  for (const drop of drops) {
    if (!drop?.itemId) {
      result.push(drop);
      continue;
    }

    const existingIndex = seen.get(drop.itemId);
    if (existingIndex == null) {
      seen.set(drop.itemId, result.length);
      result.push(drop);
      continue;
    }

    const existing = result[existingIndex];
    const oldChance = Number(existing.chance) || 0;
    const newChance = Number(drop.chance) || 0;
    if (newChance > oldChance) {
      result[existingIndex] = { ...existing, ...drop, chance: newChance };
    }
  }

  return result;
}

async function buildReport(db, oldIds) {
  const [
    oldItemCount,
    newCardCount,
    progressWithOldInventory,
    progressWithOldEquipment,
    monstersWithOldDrops
  ] = await Promise.all([
    db.collection("items").countDocuments({ itemType: "monster_card" }),
    db.collection("items").countDocuments({
      itemType: "equipment",
      equipSlot: "special",
      monsterCardSkill: { $exists: true }
    }),
    db.collection("progress").countDocuments({
      inventory: { $elemMatch: { $or: [
        { itemType: "monster_card" },
        { itemId: { $in: [...oldIds] } },
        { id: { $in: [...oldIds] } }
      ] } }
    }),
    db.collection("progress").countDocuments({
      $or: SPECIAL_SLOTS.map((slot) => ({ [`equipment.${slot}.itemType`]: "monster_card" }))
    }),
    oldIds.size
      ? db.collection("monsters").countDocuments({ "drops.itemId": { $in: [...oldIds] } })
      : Promise.resolve(0)
  ]);

  return {
    oldItemCount,
    newCardCount,
    progressWithOldInventory,
    progressWithOldEquipment,
    monstersWithOldDrops
  };
}

async function writeBackup(exportsDir, payload) {
  fs.mkdirSync(exportsDir, { recursive: true });
  const file = path.join(exportsDir, `monster-card-unify-backup-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
  return file;
}

async function main() {
  const { uri, dbName } = getMongoConfig();
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, directConnection: true });
  await client.connect();

  try {
    const db = client.db(dbName);
    const now = new Date().toISOString();
    const oldCards = await db.collection("items").find({ itemType: "monster_card" }).toArray();
    const newCards = await db.collection("items").find({
      itemType: "equipment",
      equipSlot: "special",
      monsterCardSkill: { $exists: true }
    }).toArray();
    const indexes = buildNewCardIndexes(newCards);
    const oldIds = oldItemIdSet(oldCards);
    const mapping = [];
    const unmapped = [];

    for (const oldCard of oldCards) {
      const replacement = findReplacement(oldCard, indexes);
      if (!replacement) {
        unmapped.push({
          oldId: oldCard.id || String(oldCard._id),
          name: oldCard.name || oldCard.itemName || "",
          key: getItemKey(oldCard)
        });
        continue;
      }
      mapping.push({
        oldId: oldCard.id || String(oldCard._id),
        oldObjectId: String(oldCard._id),
        oldName: oldCard.name || oldCard.itemName || "",
        newId: replacement.id || String(replacement._id),
        newName: replacement.name || replacement.itemName || "",
        monsterCardOf: replacement.monsterCardOf || oldCard.monsterCardOf || null
      });
    }

    if (unmapped.length) {
      throw new Error(`有 ${unmapped.length} 張舊卡找不到新版對應，已停止：${unmapped.map((x) => x.name || x.oldId).join(", ")}`);
    }

    const idMap = new Map();
    for (const row of mapping) {
      idMap.set(String(row.oldId), row.newId);
      idMap.set(String(row.oldObjectId), row.newId);
    }

    const before = await buildReport(db, oldIds);
    const affectedProgress = await db.collection("progress").find({
      $or: [
        { "inventory.itemType": "monster_card" },
        { "inventory.itemId": { $in: [...oldIds] } },
        ...SPECIAL_SLOTS.map((slot) => ({ [`equipment.${slot}.itemType`]: "monster_card" }))
      ]
    }).toArray();
    const affectedMonsters = await db.collection("monsters").find({
      "drops.itemId": { $in: [...oldIds] }
    }).toArray();

    let backupPath = null;
    if (BACKUP_ENABLED) {
      backupPath = await writeBackup(path.resolve(__dirname, "../exports"), {
        exportedAt: now,
        mode: WRITE_ENABLED ? "apply" : "dry-run",
        mapping,
        oldCards,
        affectedProgress,
        affectedMonsters
      });
    }

    let progressUpdated = 0;
    let inventoryEntriesRemoved = 0;
    let equippedEntriesRemoved = 0;
    for (const progress of affectedProgress) {
      const next = clone(progress);
      let changed = false;

      if (Array.isArray(next.inventory)) {
        const originalLength = next.inventory.length;
        next.inventory = next.inventory.filter((entry) => !isOldCardEntry(entry, oldIds));
        const removed = originalLength - next.inventory.length;
        if (removed > 0) {
          inventoryEntriesRemoved += removed;
          changed = true;
        }
      }

      if (next.equipment && typeof next.equipment === "object") {
        for (const slot of SPECIAL_SLOTS) {
          if (isOldCardEntry(next.equipment[slot], oldIds)) {
            next.equipment[slot] = null;
            equippedEntriesRemoved += 1;
            changed = true;
          }
        }
      }

      if (changed) {
        progressUpdated += 1;
        if (WRITE_ENABLED) {
          await db.collection("progress").updateOne(
            { _id: progress._id },
            { $set: { inventory: next.inventory, equipment: next.equipment, updatedAt: now } }
          );
        }
      }
    }

    let monstersUpdated = 0;
    let dropRefsRepointed = 0;
    for (const monster of affectedMonsters) {
      const next = clone(monster);
      let changed = false;
      if (Array.isArray(next.drops)) {
        next.drops = next.drops.map((drop) => {
          const replacementId = idMap.get(String(drop?.itemId || ""));
          if (!replacementId) return drop;
          changed = true;
          dropRefsRepointed += 1;
          return { ...drop, itemId: replacementId, source: drop.source || "monster_card" };
        });
        next.drops = dedupeDrops(next.drops);
      }
      if (changed) {
        monstersUpdated += 1;
        if (WRITE_ENABLED) {
          await db.collection("monsters").updateOne(
            { _id: monster._id },
            { $set: { drops: next.drops, updatedAt: now } }
          );
        }
      }
    }

    let oldItemsDeleted = 0;
    if (WRITE_ENABLED && oldCards.length) {
      const result = await db.collection("items").deleteMany({ _id: { $in: oldCards.map((card) => card._id) } });
      oldItemsDeleted = result.deletedCount || 0;
    } else {
      oldItemsDeleted = oldCards.length;
    }

    const after = WRITE_ENABLED ? await buildReport(db, oldIds) : before;
    console.log(JSON.stringify({
      ok: true,
      mode: WRITE_ENABLED ? "apply" : "dry-run",
      dbName,
      backupPath,
      mappingCount: mapping.length,
      progressUpdated,
      inventoryEntriesRemoved,
      equippedEntriesRemoved,
      monstersUpdated,
      dropRefsRepointed,
      oldItemsDeleted,
      before,
      after
    }, null, 2));
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
