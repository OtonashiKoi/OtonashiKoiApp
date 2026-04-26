const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function normalizeCardEntry(entry, fallbackSlot = "special") {
  if (!entry || typeof entry !== "object") return entry;
  const next = { ...entry };
  next.itemType = "equipment";
  next.equipSlot = next.equipSlot || fallbackSlot;
  next.slotType = next.slotType || "special_1";
  next.updatedAt = new Date().toISOString();
  return next;
}

async function main() {
  const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
  const mongoDbName = process.env.MONGODB_DB_NAME || "equipment_game";
  const client = new MongoClient(mongoUri, {
    serverSelectionTimeoutMS: 5000,
    directConnection: true
  });
  await client.connect();
  const db = client.db(mongoDbName);
  const now = new Date().toISOString();
  const exportsDir = path.resolve(__dirname, "../exports");
  fs.mkdirSync(exportsDir, { recursive: true });

  try {
    const oldItems = await db.collection("items").find({ itemType: "monster_card" }).toArray();
    const oldProgress = await db.collection("progress").find({
      $or: [
        { "inventory.itemType": "monster_card" },
        { "equipment.special_1.itemType": "monster_card" },
        { "equipment.special_2.itemType": "monster_card" },
        { "equipment.special_3.itemType": "monster_card" }
      ]
    }).toArray();
    const oldMonsters = await db.collection("monsters").find({
      $or: [
        { "equipment.special_1.itemType": "monster_card" },
        { "equipment.special_2.itemType": "monster_card" },
        { "equipment.special_3.itemType": "monster_card" }
      ]
    }).toArray();

    const backupPath = path.join(exportsDir, `monster-card-migration-backup-${Date.now()}.json`);
    fs.writeFileSync(
      backupPath,
      JSON.stringify(
        {
          exportedAt: now,
          items: oldItems,
          progress: oldProgress,
          monsters: oldMonsters
        },
        null,
        2
      ),
      "utf8"
    );

    let itemUpdated = 0;
    for (const item of oldItems) {
      await db.collection("items").updateOne(
        { _id: item._id },
        {
          $set: {
            itemType: "equipment",
            equipSlot: item.equipSlot || "special",
            slotType: item.slotType || "special_1",
            updatedAt: now
          }
        }
      );
      itemUpdated += 1;
    }

    let progressUpdated = 0;
    let inventoryEntriesUpdated = 0;
    let equippedEntriesUpdated = 0;
    for (const progress of oldProgress) {
      const next = clone(progress);
      let changed = false;

      if (Array.isArray(next.inventory)) {
        next.inventory = next.inventory.map((entry) => {
          if (entry?.itemType !== "monster_card") return entry;
          changed = true;
          inventoryEntriesUpdated += 1;
          return normalizeCardEntry(entry, "special");
        });
      }

      if (next.equipment && typeof next.equipment === "object") {
        for (const slot of ["special_1", "special_2", "special_3"]) {
          if (next.equipment[slot]?.itemType === "monster_card") {
            next.equipment[slot] = normalizeCardEntry(next.equipment[slot], "special");
            changed = true;
            equippedEntriesUpdated += 1;
          }
        }
      }

      if (changed) {
        next.updatedAt = now;
        await db.collection("progress").replaceOne({ _id: progress._id }, next);
        progressUpdated += 1;
      }
    }

    let monstersUpdated = 0;
    for (const monster of oldMonsters) {
      const next = clone(monster);
      let changed = false;
      if (next.equipment && typeof next.equipment === "object") {
        for (const slot of ["special_1", "special_2", "special_3"]) {
          if (next.equipment[slot]?.itemType === "monster_card") {
            next.equipment[slot] = normalizeCardEntry(next.equipment[slot], "special");
            changed = true;
          }
        }
      }
      if (changed) {
        next.updatedAt = now;
        await db.collection("monsters").replaceOne({ _id: monster._id }, next);
        monstersUpdated += 1;
      }
    }

    console.log(JSON.stringify({
      ok: true,
      backupPath,
      itemUpdated,
      progressUpdated,
      inventoryEntriesUpdated,
      equippedEntriesUpdated,
      monstersUpdated
    }, null, 2));
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
