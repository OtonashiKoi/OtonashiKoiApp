require('dotenv').config();
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGO_DB_NAME || 'equipment_game';

async function main(){
  const argv = process.argv.slice(2);
  const doIt = argv.includes('--yes');

  const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(DB_NAME);

  // try to find wooden sword in items
  const itemsCol = db.collection('items');
  let item = await itemsCol.findOne({ name: '木劍' });
  if (!item) item = await itemsCol.findOne({ name: /木劍/ });
  if (!item) {
    console.error('找不到 items 中的 木劍，請先確認 items 集合。');
    await client.close();
    process.exit(1);
  }

  const progress = db.collection('progress');
  const cursor = progress.find({}, { projection: { playerId:1, inventory:1 } });
  const toGrant = [];
  while (await cursor.hasNext()){
    const doc = await cursor.next();
    const inv = Array.isArray(doc.inventory) ? doc.inventory : [];
    const already = inv.find(i => i.itemId === item.id || i.itemName === item.name || i.name === item.name || i.displayName === item.name);
    if (!already) toGrant.push(doc.playerId);
  }

  console.log(`Found ${toGrant.length} players without 木劍.`);
  if (!doIt){
    console.log('Dry-run only. To actually grant run with `--yes` flag.');
    await client.close();
    return;
  }

  for (const pid of toGrant){
    const entry = {
      uuid: crypto.randomUUID(),
      itemId: item.id,
      itemName: item.name,
      itemEffect: item.effect || { type: 'none', value: 0 },
      itemType: item.itemType || 'equipment',
      imageUrl: item.imageUrl || null,
      imageThumbnailUrl: item.imageThumbnailUrl || null,
      equipSlot: item.equipSlot || null,
      equipStats: item.equipStats || null,
      weaponType: item.weaponType || null,
      isTwoHanded: item.isTwoHanded || false,
      grantedAt: new Date().toISOString(),
      grantedBy: 'grant-wooden-sword-all-script'
    };

    await progress.updateOne({ playerId: pid }, { $push: { inventory: entry }, $set: { updatedAt: new Date().toISOString() } }, { upsert: true });
    console.log('Granted to', pid, entry.uuid);
  }

  await client.close();
}

main().catch(e=>{ console.error(e); process.exit(1); });
