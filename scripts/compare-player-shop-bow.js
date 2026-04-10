// scripts/compare-player-shop-bow.js
// 用法: node scripts/compare-player-shop-bow.js <discordId>
"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");

async function main() {
  const discordId = process.argv[2];
  if (!discordId) {
    console.error("Usage: node scripts/compare-player-shop-bow.js <discordId>");
    process.exit(2);
  }
  const MONGODB_URI = process.env.MONGODB_URI;
  const DB = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "equipment_game";
  if (!MONGODB_URI) {
    console.error("Please set MONGODB_URI in .env");
    process.exit(2);
  }

  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(DB);

  // try both progress collection and fallback to players/progress in other shapes
  const progress = (await db.collection("progress").findOne({ playerId: discordId }))
    || (await db.collection("progress").findOne({ discordId }))
    || (await db.collection("players").findOne({ discordId }))
    || null;

  if (!progress) {
    console.log("No progress found for", discordId);
    await client.close();
    return;
  }

  // normalize progress shape
  const playerProgress = progress.playerId ? progress : progress.value || progress;

  const equippedBow = (playerProgress.equipment && playerProgress.equipment.weapon && playerProgress.equipment.weapon.weaponType === "bow") ? playerProgress.equipment.weapon : null;
  const inventoryBows = (playerProgress.inventory || []).filter(i => i.weaponType === "bow" || (i.equipSlot === "weapon" && i.weaponType === "bow"));

  console.log("=== Player:", discordId, "===\n");
  console.log("Equipped bow (weapon slot):", equippedBow ? JSON.stringify(equippedBow, null, 2) : "(none)");
  console.log("\nInventory bows:", inventoryBows.length);
  inventoryBows.forEach(b => console.log(JSON.stringify(b, null, 2)));

  // 從 items collection 列出所有 bow
  const libraryBows = await db.collection("items").find({ weaponType: "bow" }).toArray();
  console.log("\n=== Library bows (items collection) ===");
  libraryBows.forEach(b => {
    console.log(`- id:${b.id} name:${b.name} tier:${b.tier} equipStats:${JSON.stringify(b.equipStats)} isTwoHanded:${b.isTwoHanded}`);
  });

  // shopItems referencing bows
  const libraryIds = libraryBows.map(b => b.id);
  const shopEntries = await db.collection("shopItems").find({ itemLibraryId: { $in: libraryIds } }).toArray().catch(() => []);
  console.log("\n=== Shop entries referencing library bows ===");
  if (!shopEntries.length) console.log("(none)");
  shopEntries.forEach(s => {
    console.log(`- shopId:${s.id} itemLibraryId:${s.itemLibraryId} name:${s.name} price:${s.price} currency:${s.currency} stock:${s.stock}`);
  });

  function diffObj(a, b, keys) {
    const diffs = {};
    keys.forEach(k => {
      const va = a && (a[k] === undefined ? null : a[k]);
      const vb = b && (b[k] === undefined ? null : b[k]);
      if (JSON.stringify(va) !== JSON.stringify(vb)) diffs[k] = { player: va, library: vb };
    });
    return diffs;
  }

  console.log("\n=== 比對（玩家 vs library bows） ===");
  const compareKeys = ["name", "equipStats", "weaponType", "isTwoHanded", "atkStat", "tier", "itemId", "itemName"];
  const players = [];
  if (equippedBow) players.push({ source: "equipped", obj: equippedBow });
  inventoryBows.forEach((b, i) => players.push({ source: `inventory[${i}]`, obj: b }));

  for (const p of players) {
    console.log(`\n-- ${p.source} --`);
    const byId = p.obj.itemId ? libraryBows.find(lb => lb.id === p.obj.itemId) : null;
    const byName = libraryBows.find(lb => lb.name === p.obj.itemName) || null;
    const byType = libraryBows.find(lb => lb.weaponType === p.obj.weaponType && JSON.stringify(lb.equipStats) === JSON.stringify(p.obj.equipStats)) || null;

    const lib = byId || byName || byType;
    if (!lib) {
      console.log("No matching library bow found for this player's bow (try name/itemId/weaponType)");
      continue;
    }
    console.log("Matched library id:", lib.id, "name:", lib.name);
    const diffs = diffObj(p.obj, lib, compareKeys);
    if (Object.keys(diffs).length === 0) {
      console.log("No differences on inspected keys.");
    } else {
      console.log("Differences:");
      console.log(JSON.stringify(diffs, null, 2));
    }
  }

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
