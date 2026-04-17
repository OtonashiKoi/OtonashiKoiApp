require('dotenv').config();
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI || process.env.MONGODB_CLOUD_URI || process.env.MONGO_URI;
const dbName = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || 'equipment_game';

if (!uri) {
  console.error('Missing MongoDB URI in env.');
  process.exit(1);
}

(async () => {
  const client = new MongoClient(uri, { maxPoolSize: 5 });
  try {
    await client.connect();
    const db = client.db(dbName);
    const playersCol = db.collection('players');
    const walletsCol = db.collection('wallets');
    const progressCol = db.collection('progress');

    const players = await playersCol.find({}).limit(5).toArray();
    for (const p of players) {
      const playerId = p.discordId;
      const wallet = await walletsCol.findOne({ playerId }) || { gold: 0, diamond: 0 };
      const progress = await progressCol.findOne({ playerId }) || {};

      console.log('---');
      console.log('playerId:', playerId, 'displayName:', p.displayName || p.name || '');
      console.log('wallet:', { gold: wallet.gold, diamond: wallet.diamond });
      const invLen = Array.isArray(progress.inventory) ? progress.inventory.length : 0;
      const weapon = progress.equipment && progress.equipment.weapon ? progress.equipment.weapon : null;
      console.log('inventory.length:', invLen, 'weapon.itemId:', weapon ? weapon.itemId || weapon.itemId : null, 'weapon.uuid:', weapon ? weapon.uuid || null : null);
    }
  } catch (e) {
    console.error('Error:', e);
    process.exitCode = 2;
  } finally {
    await client.close();
  }
})();
