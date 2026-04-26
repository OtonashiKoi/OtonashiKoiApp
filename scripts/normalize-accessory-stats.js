const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const MONGO_URI = "mongodb://localhost:27017";
const DB_NAMES = ["equipment_game", "equipmentGAME"];
const ACCESSORY_SLOTS = new Set(["accessory_l", "accessory_r"]);
const STAT_KEYS = ["str", "agi", "vit", "int", "dex", "luk"];

function cloneStats(stats = {}) {
  const next = {};
  for (const key of STAT_KEYS) next[key] = Number(stats?.[key] || 0);
  return next;
}

function normalizeName(name) {
  return String(name || "").replace(/\s*\+\d+$/, "").trim();
}

function pickMainStat(stats) {
  return Object.entries(stats)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))[0]?.[0] || null;
}

function rebuildEnhancedStats(baseStats, enhanceLevel) {
  const next = cloneStats(baseStats);
  const level = Math.max(0, Number(enhanceLevel || 0));
  for (let i = 0; i < level; i += 1) {
    const mainStat = pickMainStat(next);
    if (!mainStat) break;
    next[mainStat] = Number(next[mainStat] || 0) + 1;
  }
  return next;
}

function statsEqual(a, b) {
  return STAT_KEYS.every((key) => Number(a?.[key] || 0) === Number(b?.[key] || 0));
}

async function run() {
  const client = new MongoClient(MONGO_URI, { directConnection: true });
  await client.connect();

  const summary = [];

  for (const dbName of DB_NAMES) {
    const db = client.db(dbName);
    const itemsCol = db.collection("items");
    const progressCol = db.collection("progress");

    const ringItems = await itemsCol.find({
      equipSlot: { $in: ["accessory_l", "accessory_r"] }
    }).project({
      _id: 1,
      name: 1,
      equipSlot: 1,
      equipStats: 1
    }).toArray().catch(() => []);

    if (!ringItems.length) {
      summary.push({ dbName, scannedPlayers: 0, updatedPlayers: 0, inventoryFixed: 0, equippedFixed: 0, backupPath: null });
      continue;
    }

    const byId = new Map();
    const byNameSlot = new Map();
    for (const item of ringItems) {
      const id = String(item._id);
      byId.set(id, item);
      byNameSlot.set(`${normalizeName(item.name)}|${item.equipSlot}`, item);
    }

    const players = await progressCol.find({
      $or: [
        { "inventory.equipSlot": { $in: ["accessory_l", "accessory_r"] } },
        { "equipment.accessory_l": { $ne: null } },
        { "equipment.accessory_r": { $ne: null } }
      ]
    }).toArray().catch(() => []);

    const backupDir = path.join(process.cwd(), "exports");
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `accessory-normalize-backup-${dbName}-${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(players, null, 2), "utf8");

    let updatedPlayers = 0;
    let inventoryFixed = 0;
    let equippedFixed = 0;

    for (const progress of players) {
      let changed = false;
      const inventory = Array.isArray(progress.inventory) ? progress.inventory : [];
      const equipment = progress.equipment && typeof progress.equipment === "object" ? progress.equipment : {};

      for (const entry of inventory) {
        if (!ACCESSORY_SLOTS.has(entry?.equipSlot)) continue;
        const sourceItem =
          byId.get(String(entry.itemId || "")) ||
          byNameSlot.get(`${normalizeName(entry.itemName || entry.name)}|${entry.equipSlot}`);
        if (!sourceItem?.equipStats) continue;
        const expectedStats = rebuildEnhancedStats(sourceItem.equipStats, entry.enhanceLevel);
        if (!statsEqual(entry.equipStats, expectedStats)) {
          entry.equipStats = expectedStats;
          inventoryFixed += 1;
          changed = true;
        }
      }

      for (const slot of ["accessory_l", "accessory_r"]) {
        const entry = equipment?.[slot];
        if (!entry) continue;
        const sourceItem =
          byId.get(String(entry.itemId || "")) ||
          byNameSlot.get(`${normalizeName(entry.itemName || entry.name)}|${slot}`);
        if (!sourceItem?.equipStats) continue;
        const expectedStats = rebuildEnhancedStats(sourceItem.equipStats, entry.enhanceLevel);
        if (!statsEqual(entry.equipStats, expectedStats)) {
          entry.equipStats = expectedStats;
          equippedFixed += 1;
          changed = true;
        }
      }

      if (changed) {
        progress.updatedAt = new Date().toISOString();
        await progressCol.updateOne(
          { _id: progress._id },
          { $set: { inventory: progress.inventory || [], equipment: progress.equipment || {}, updatedAt: progress.updatedAt } }
        );
        updatedPlayers += 1;
      }
    }

    summary.push({ dbName, scannedPlayers: players.length, updatedPlayers, inventoryFixed, equippedFixed, backupPath });
  }

  await client.close();
  console.log(JSON.stringify({ ok: true, summary }, null, 2));
}

run().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exit(1);
});
