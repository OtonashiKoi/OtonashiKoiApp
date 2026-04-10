require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URL || null;
const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGO_DB_NAME || 'equipment_game';

// 目標 goldReward（Normal zone）
const TARGET_GOLD = {
  '小史(小)': 800,
  '哥布':     1000,
  '石頭':     1200,
  '小狼':      900,
  '大史(B)':  3000,
};

async function main() {
  const doIt = process.argv.includes('--yes');

  const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const col = client.db(DB_NAME).collection('monsters');

  const monsters = await col.find({ zone: 'normal' }, { projection: { name: 1, id: 1, goldReward: 1, expReward: 1, entryFee: 1 } }).toArray();
  console.log('Normal zone monsters:');
  monsters.forEach(m => console.log(`  ${m.name}  gold:${m.goldReward}  exp:${m.expReward}  entry:${m.entryFee}`));

  console.log('\nProposed changes:');
  const toUpdate = [];
  for (const m of monsters) {
    const newGold = TARGET_GOLD[m.name];
    if (newGold !== undefined && m.goldReward !== newGold) {
      console.log(`  ${m.name}: ${m.goldReward} → ${newGold}`);
      toUpdate.push({ id: m._id, name: m.name, newGold });
    }
  }

  if (!doIt) {
    console.log('\nDry-run. Add --yes to apply.');
    await client.close();
    return;
  }

  for (const u of toUpdate) {
    await col.updateOne({ _id: u.id }, { $set: { goldReward: u.newGold, updatedAt: new Date().toISOString() } });
    console.log(`Updated ${u.name} goldReward → ${u.newGold}`);
  }
  console.log('Done.');
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
