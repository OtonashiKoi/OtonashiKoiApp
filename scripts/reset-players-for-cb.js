#!/usr/bin/env node
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { MongoClient } = require("mongodb");

const uri =
  process.env.MONGODB_URI ||
  process.env.MONGODB_CLOUD_URI ||
  process.env.MONGO_URI ||
  "mongodb://localhost:27017";
const dbName =
  process.env.MONGODB_DB_NAME ||
  process.env.MONGODB_DB ||
  "equipment_game";

const WOODEN_SWORD_ID = "a56bd609-cf0b-4924-b724-891f221fc0b9";
const EMPTY_ATTRIBUTES = {
  str: 1,
  agi: 1,
  vit: 1,
  int: 1,
  dex: 1,
  luk: 1
};

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function isCollectible(item) {
  return item?.itemType === "collectible";
}

function isSpecialTitle(item) {
  return item?.equipSlot === "title_eq";
}

function makeSwordInstance(item, now) {
  return {
    uuid: randomUUID(),
    itemId: item.id,
    itemName: item.name,
    itemEffect: item.effect || { type: "none", value: 0 },
    useEffects: Array.isArray(item.useEffects) ? item.useEffects : [],
    passiveEffects: Array.isArray(item.passiveEffects) ? item.passiveEffects : [],
    procEffects: Array.isArray(item.procEffects) ? item.procEffects : [],
    combatEffects: Array.isArray(item.combatEffects) ? item.combatEffects : [],
    itemType: item.itemType || "equipment",
    imageUrl: item.imageUrl || null,
    imageThumbnailUrl: item.imageThumbnailUrl || null,
    equipSlot: item.equipSlot || "weapon",
    equipStats: item.equipStats || {},
    weaponType: item.weaponType || null,
    isTwoHanded: Boolean(item.isTwoHanded),
    grantedAt: now,
    grantedBy: "reset-players-for-cb-script",
    atkStat: item.atkStat || null,
    tier: item.tier || "D",
    enhanceLevel: 0
  };
}

function emptyEquipment(preservedTitle) {
  return {
    head_top: null,
    head_mid: null,
    head_low: null,
    armor: null,
    weapon: null,
    shield: null,
    garment: null,
    shoes: null,
    accessory_l: null,
    accessory_r: null,
    title_eq: preservedTitle || null,
    job_eq: null,
    special_1: null,
    special_2: null,
    special_3: null
  };
}

(async () => {
  const client = new MongoClient(uri, { maxPoolSize: 10 });
  try {
    await client.connect();
    const db = client.db(dbName);
    const playersCol = db.collection("players");
    const walletsCol = db.collection("wallets");
    const progressCol = db.collection("progress");
    const itemsCol = db.collection("items");

    const swordItem = await itemsCol.findOne(
      { id: WOODEN_SWORD_ID },
      { projection: { _id: 0 } }
    );
    if (!swordItem) {
      throw new Error(`找不到木製單手劍道具：${WOODEN_SWORD_ID}`);
    }

    const exportsDir = path.join(process.cwd(), "exports");
    ensureDir(exportsDir);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");

    const [allPlayers, allWallets, allProgress] = await Promise.all([
      playersCol.find({}).toArray(),
      walletsCol.find({}).toArray(),
      progressCol.find({}).toArray()
    ]);

    writeJson(path.join(exportsDir, `players-backup-${ts}.json`), allPlayers);
    writeJson(path.join(exportsDir, `wallets-backup-${ts}.json`), allWallets);
    writeJson(path.join(exportsDir, `progress-backup-${ts}.json`), allProgress);

    const progressByPlayerId = new Map(allProgress.map((row) => [row.playerId, row]));
    const walletByPlayerId = new Map(allWallets.map((row) => [row.playerId, row]));
    const allPlayerIds = new Set([
      ...allPlayers.map((row) => row.discordId).filter(Boolean),
      ...allProgress.map((row) => row.playerId).filter(Boolean),
      ...allWallets.map((row) => row.playerId).filter(Boolean)
    ]);

    let collectibleKept = 0;
    let titleKeptInInventory = 0;
    let titleKeptEquipped = 0;
    let playersProcessed = 0;

    for (const playerId of allPlayerIds) {
      if (!playerId) continue;

      const now = new Date().toISOString();
      const progress = progressByPlayerId.get(playerId) || {};
      const inventory = Array.isArray(progress.inventory) ? progress.inventory : [];

      const keptInventory = inventory.filter((item) => isCollectible(item) || isSpecialTitle(item));
      collectibleKept += keptInventory.filter(isCollectible).length;
      titleKeptInInventory += keptInventory.filter(isSpecialTitle).length;

      const equippedTitle = progress?.equipment?.title_eq && isSpecialTitle(progress.equipment.title_eq)
        ? progress.equipment.title_eq
        : null;
      if (equippedTitle) titleKeptEquipped += 1;

      const swordEntry = makeSwordInstance(swordItem, now);
      keptInventory.push(swordEntry);

      const nextProgress = {
        playerId,
        level: 1,
        exp: 0,
        job: "Novice",
        jobLevel: 1,
        statusPoints: 0,
        allocatedPoints: 0,
        attributes: { ...EMPTY_ATTRIBUTES },
        inventory: keptInventory,
        equipment: emptyEquipment(equippedTitle),
        activeEffects: [],
        flags: {},
        updatedAt: now
      };

      if (!progress.createdAt) {
        nextProgress.createdAt = now;
      }

      if (progress.playerTier) {
        nextProgress.playerTier = progress.playerTier;
      }

      await progressCol.updateOne(
        { playerId },
        { $set: nextProgress },
        { upsert: true }
      );

      const prevWallet = walletByPlayerId.get(playerId) || {};
      await walletsCol.updateOne(
        { playerId },
        {
          $set: {
            playerId,
            gold: 300,
            diamond: Number(prevWallet.diamond || 0),
            updatedAt: now
          }
        },
        { upsert: true }
      );

      playersProcessed += 1;
    }

    console.log(JSON.stringify({
      ok: true,
      playersProcessed,
      collectibleKept,
      titleKeptInInventory,
      titleKeptEquipped,
      backups: [
        `players-backup-${ts}.json`,
        `wallets-backup-${ts}.json`,
        `progress-backup-${ts}.json`
      ]
    }, null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
})();
