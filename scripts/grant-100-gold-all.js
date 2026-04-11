require('dotenv').config();
const config = require('../src/config');
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI || config.storage.mongoUri;
const dbName = process.env.MONGODB_DB_NAME || config.storage.mongoDbName || 'equipment_game';
const confirm = process.argv.includes('--yes') || process.argv.includes('-y') || process.env.AUTO_CONFIRM === 'true';
const amount = Number(process.env.GIVE_AMOUNT || 100);

if (!uri) {
  console.error('MONGODB_URI is not set. Please set it in the environment or .env file.');
  process.exit(1);
}

(async () => {
  const client = await MongoClient.connect(uri).catch(e => { console.error('Failed to connect to MongoDB:', e); process.exit(1); });
  try {
    const db = client.db(dbName);
    const wallets = db.collection('wallets');
    const count = await wallets.countDocuments({});
    console.log(`Found ${count} wallet document(s) in DB "${dbName}".`);

    if (!confirm) {
      console.log('Dry run — no changes applied.');
      console.log('To apply changes, re-run with `--yes` or set `AUTO_CONFIRM=true` in the environment.');
      console.log(`Will add ${amount} gold to each wallet (estimated total gold added = ${amount} * ${count}).`);
      await client.close();
      process.exit(0);
    }

    console.log(`Applying: adding ${amount} gold to each wallet...`);
    const r = await wallets.updateMany({}, [
      { $set: { gold: { $add: [{ $ifNull: ['$gold', 0] }, amount] } } }
    ]);
    console.log('matched:', r.matchedCount, 'modified:', r.modifiedCount);
    console.log(`Estimated total gold added: ${r.modifiedCount * amount}`);
  } catch (e) {
    console.error('Error while updating wallets:', e);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
})();
