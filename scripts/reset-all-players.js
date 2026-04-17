require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { randomUUID } = require('crypto');

const uri = process.env.MONGODB_URI || process.env.MONGODB_CLOUD_URI || process.env.MONGO_URI;
const dbName = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || 'equipment_game';

if (!uri) {
  console.error('Missing MongoDB URI in env (MONGODB_URI or MONGODB_CLOUD_URI).');
  process.exit(1);
}

const WOODEN_SWORD_ID = 'a56bd609-cf0b-4924-b724-891f221fc0b9';

function safeWriteJson(filePath, obj) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
}

(async () => {
  const client = new MongoClient(uri, { maxPoolSize: 10 });
  try {
    await client.connect();
    const db = client.db(dbName);
    const playersCol = db.collection('players');
    const walletsCol = db.collection('wallets');
    const progressCol = db.collection('progress');
    const itemsCol = db.collection('items');

    console.log('Connected to', uri, 'db:', dbName);

    const exportsDir = path.join(process.cwd(), 'exports');
    if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');

    // Backups
    console.log('Backing up players, wallets, progress...');
    const [allPlayers, allWallets, allProgress] = await Promise.all([
      playersCol.find({}).toArray(),
      walletsCol.find({}).toArray(),
      progressCol.find({}).toArray()
    ]);

    safeWriteJson(path.join(exportsDir, `players-backup-${ts}.json`), allPlayers);
    safeWriteJson(path.join(exportsDir, `wallets-backup-${ts}.json`), allWallets);
    safeWriteJson(path.join(exportsDir, `progress-backup-${ts}.json`), allProgress);
    console.log(`Backups written to exports/ (players:${allPlayers.length}, wallets:${allWallets.length}, progress:${allProgress.length})`);

    // Load wooden sword definition
    const woodItem = await itemsCol.findOne({ id: WOODEN_SWORD_ID }) || await itemsCol.findOne({ _id: WOODEN_SWORD_ID });
    if (!woodItem) {
      console.warn('木製單手劍找不到於 items collection，將只重設金幣與清空道具欄。');
    }

    // List all players to operate on
    const players = allPlayers;
    let walletsUpserted = 0;
    let progressUpdated = 0;

    for (const p of players) {
      const playerId = p.discordId;
      if (!playerId) continue;

      // Upsert wallet -> set gold to 300 and diamond to 0
      await walletsCol.updateOne(
        { playerId },
        { $set: { playerId, gold: 300, diamond: 0, updatedAt: new Date().toISOString() } },
        { upsert: true }
      );
      walletsUpserted++;

      // Prepare inventory / equipment reset
      const grantUuid = randomUUID();
      const now = new Date().toISOString();

      const inventoryEntry = woodItem ? {
        uuid: grantUuid,
        itemId: woodItem.id || woodItem._id,
        itemName: woodItem.name || woodItem.itemName || woodItem.label || woodItem.itemName,
        itemEffect: woodItem.itemEffect || { type: 'none', value: 0 },
        itemType: woodItem.itemType || 'equipment',
        imageUrl: woodItem.imageUrl || woodItem.image || null,
        imageThumbnailUrl: woodItem.imageThumbnailUrl || null,
        equipSlot: woodItem.equipSlot || (woodItem.weaponType ? 'weapon' : null),
        equipStats: woodItem.equipStats || woodItem.stats || {},
        weaponType: woodItem.weaponType || null,
        isTwoHanded: woodItem.isTwoHanded || false,
        grantedAt: now,
        grantedBy: 'server-reset-script',
        atkStat: woodItem.atkStat || 'str',
        tier: woodItem.tier || 'D',
        enhanceLevel: 0
      } : null;

      // Update progress: clear inventory/equipment then grant wooden sword if available
      const updateFields = { inventory: [], equipment: {} };
      if (inventoryEntry) {
        updateFields.inventory = [inventoryEntry];
        updateFields.equipment = { weapon: { ...inventoryEntry, uuid: grantUuid } };
      }

      await progressCol.updateOne(
        { playerId },
        { $set: { playerId, ...updateFields, updatedAt: now } },
        { upsert: true }
      );
      progressUpdated++;
    }

    console.log(`Processed ${players.length} players: wallets upserted=${walletsUpserted}, progress updated=${progressUpdated}`);
    console.log('Sample file locations:', fs.readdirSync(exportsDir).slice(-6));
    console.log('Done. Review backups before deploying further changes.');
  } catch (err) {
    console.error('Error during reset:', err);
    process.exitCode = 2;
  } finally {
    await client.close();
  }
})();
