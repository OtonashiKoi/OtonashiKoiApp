const { MongoClient } = require("mongodb");
const fs = require("fs");
const path = require("path");

const MONGO_URI = "mongodb://localhost:27017";
const DB_NAMES = ["equipment_game", "equipmentGAME"];
const TWO_HANDED_WEAPON_TYPES = new Set(["sword_2h", "axe_2h", "mace_2h", "staff_2h", "bow"]);

function isTwoHandedWeapon(entry) {
  const weaponType = String(entry?.weaponType || "");
  return TWO_HANDED_WEAPON_TYPES.has(weaponType);
}

async function run() {
  const client = new MongoClient(MONGO_URI, { directConnection: true });
  await client.connect();
  const summary = [];

  for (const dbName of DB_NAMES) {
    const db = client.db(dbName);
    const itemsCol = db.collection("items");
    const progressCol = db.collection("progress");

    const wrongItems = await itemsCol.find({
      itemType: "equipment",
      weaponType: { $in: [...TWO_HANDED_WEAPON_TYPES] },
      isTwoHanded: { $ne: true }
    }).toArray().catch(() => []);

    let itemUpdated = 0;
    if (wrongItems.length > 0) {
      const ids = wrongItems.map((item) => item._id);
      const result = await itemsCol.updateMany(
        { _id: { $in: ids } },
        { $set: { isTwoHanded: true, updatedAt: new Date().toISOString() } }
      );
      itemUpdated = Number(result.modifiedCount || 0);
    }

    const players = await progressCol.find({
      $or: [
        { "equipment.weapon.weaponType": { $in: [...TWO_HANDED_WEAPON_TYPES] } },
        { "inventory.weaponType": { $in: [...TWO_HANDED_WEAPON_TYPES] } }
      ]
    }).toArray().catch(() => []);

    const backupDir = path.join(process.cwd(), "exports");
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `two-handed-fix-backup-${dbName}-${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(players, null, 2), "utf8");

    let progressUpdated = 0;
    let inventoryFixed = 0;
    let weaponFixed = 0;
    let shieldsUnequipped = 0;
    let weaponsUnequipped = 0;

    for (const progress of players) {
      let changed = false;
      const inventory = Array.isArray(progress.inventory) ? progress.inventory : [];
      const equipment = progress.equipment && typeof progress.equipment === "object" ? progress.equipment : {};

      for (const entry of inventory) {
        if (!isTwoHandedWeapon(entry)) continue;
        if (entry.isTwoHanded !== true) {
          entry.isTwoHanded = true;
          inventoryFixed += 1;
          changed = true;
        }
      }

      const weapon = equipment.weapon;
      if (isTwoHandedWeapon(weapon)) {
        if (weapon.isTwoHanded !== true) {
          weapon.isTwoHanded = true;
          weaponFixed += 1;
          changed = true;
        }
        inventory.push(weapon);
        equipment.weapon = null;
        weaponsUnequipped += 1;
        changed = true;
        if (equipment.shield) {
          inventory.push(equipment.shield);
          equipment.shield = null;
          shieldsUnequipped += 1;
          changed = true;
        }
      }

      if (changed) {
        progress.updatedAt = new Date().toISOString();
        await progressCol.updateOne(
          { _id: progress._id },
          { $set: { inventory, equipment, updatedAt: progress.updatedAt } }
        );
        progressUpdated += 1;
      }
    }

    summary.push({
      dbName,
      itemUpdated,
      scannedPlayers: players.length,
      progressUpdated,
      inventoryFixed,
      weaponFixed,
      weaponsUnequipped,
      shieldsUnequipped,
      backupPath
    });
  }

  await client.close();
  console.log(JSON.stringify({ ok: true, summary }, null, 2));
}

run().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exit(1);
});
