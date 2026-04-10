require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGO_DB_NAME || 'equipment_game';

async function main() {
  const argv = process.argv.slice(2);
  const doIt = argv.includes('--yes');

  const client = new MongoClient(MONGO_URI, { useUnifiedTopology: true });
  await client.connect();
  const db = client.db(DB_NAME);
  const progress = db.collection('progress');

  const matcher = {
    inventory: {
      $elemMatch: {
        $or: [
          { displayName: '金幣袋子(小)' },
          { name: '金幣袋子(小)' },
          { itemName: '金幣袋子(小)' }
        ]
      }
    }
  };

  const affectedCount = await progress.countDocuments(matcher);
  console.log(`Found ${affectedCount} progress documents containing 金幣袋子(小)`);

  if (!doIt) {
    console.log('Dry-run only. To actually remove these items run with `--yes` flag.');
    await client.close();
    return;
  }

  const res = await progress.updateMany(matcher, {
    $pull: {
      inventory: {
        $or: [
          { displayName: '金幣袋子(小)' },
          { name: '金幣袋子(小)' },
          { itemName: '金幣袋子(小)' }
        ]
      }
    }
  });

  console.log('Update result:', { matchedCount: res.matchedCount, modifiedCount: res.modifiedCount });
  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
