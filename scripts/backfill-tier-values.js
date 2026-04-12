require("dotenv").config();

const { MongoClient } = require("mongodb");

const VALID_TIERS = new Set(["D", "C", "B", "A"]);

function normalizeName(name) {
  return String(name || "").replace(/\s*\+\d+$/, "").trim();
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME || "equipment_game";
  if (!uri) throw new Error("MONGODB_URI is required");

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const itemsCol = db.collection("items");
  const shopCol = db.collection("shopItems");
  const progressCol = db.collection("progress");

  const [items, shopItems, progresses] = await Promise.all([
    itemsCol.find({}).toArray(),
    shopCol.find({}).toArray(),
    progressCol.find({}).toArray()
  ]);

  const libById = new Map();
  const libByName = new Map();
  for (const item of items) {
    const id = item.id || item._id?.toString();
    if (id) libById.set(id, item);
    const key = normalizeName(item.name);
    if (!key) continue;
    const arr = libByName.get(key) || [];
    arr.push(item);
    libByName.set(key, arr);
  }

  const shopById = new Map();
  let patchedShopItems = 0;
  for (const shopItem of shopItems) {
    const shopId = shopItem.id || shopItem._id?.toString();
    if (shopId) shopById.set(shopId, shopItem);

    const libId = shopItem.itemLibraryId || null;
    const libItem = libId ? libById.get(libId) : null;
    const nextTier = libItem?.tier || null;
    const curTier = VALID_TIERS.has(shopItem.tier) ? shopItem.tier : null;

    if (nextTier && curTier !== nextTier) {
      await shopCol.updateOne(
        { _id: shopItem._id },
        { $set: { tier: nextTier, updatedAt: new Date().toISOString() } }
      );
      patchedShopItems += 1;
    }
  }

  let patchedPlayers = 0;
  let patchedEntries = 0;
  let relinkedItemIds = 0;

  for (const progress of progresses) {
    let dirty = false;

    const patchEntry = (entry) => {
      if (!entry || typeof entry !== "object") return entry;
      let changed = false;
      const next = { ...entry };

      const originalItemId = next.itemId;
      if (originalItemId && shopById.has(originalItemId)) {
        const shopItem = shopById.get(originalItemId);
        if (shopItem.itemLibraryId && shopItem.itemLibraryId !== originalItemId) {
          next.itemId = shopItem.itemLibraryId;
          changed = true;
          relinkedItemIds += 1;
        }
      }

      if (next.itemType === "equipment") {
        let libItem = next.itemId ? libById.get(next.itemId) : null;
        if (!libItem) {
          const byName = libByName.get(normalizeName(next.itemName));
          if (Array.isArray(byName) && byName.length === 1) libItem = byName[0];
        }
        const libTier = libItem?.tier || null;
        const curTier = VALID_TIERS.has(next.tier) ? next.tier : null;
        if (!curTier && libTier) {
          next.tier = libTier;
          changed = true;
        }
      }

      if (changed) {
        dirty = true;
        patchedEntries += 1;
      }
      return next;
    };

    const nextInventory = Array.isArray(progress.inventory)
      ? progress.inventory.map(patchEntry)
      : progress.inventory;

    let nextEquipment = progress.equipment;
    if (progress.equipment && typeof progress.equipment === "object") {
      nextEquipment = {};
      for (const [slot, entry] of Object.entries(progress.equipment)) {
        nextEquipment[slot] = patchEntry(entry);
      }
    }

    if (dirty) {
      patchedPlayers += 1;
      await progressCol.updateOne(
        { _id: progress._id },
        {
          $set: {
            inventory: nextInventory,
            equipment: nextEquipment,
            updatedAt: new Date().toISOString()
          }
        }
      );
    }
  }

  console.log("[BackfillTier] done");
  console.log(`[BackfillTier] shopItems patched: ${patchedShopItems}`);
  console.log(`[BackfillTier] players patched: ${patchedPlayers}`);
  console.log(`[BackfillTier] entries patched: ${patchedEntries}`);
  console.log(`[BackfillTier] itemId relinked: ${relinkedItemIds}`);

  await client.close();
}

main().catch((error) => {
  console.error("[BackfillTier] failed:", error);
  process.exit(1);
});

