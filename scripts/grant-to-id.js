require('dotenv').config();
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

async function run() {
  const discordId = process.argv[2] || process.env.TARGET_DISCORD_ID;
  if (!discordId) {
    console.error('Usage: node scripts/grant-to-id.js <discordId>');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME || 'equipment_game';
  if (!uri) throw new Error('MONGODB_URI not set');

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(dbName);

  const itemName = '樂園CCB勇者';
  const item = await db.collection('items').findOne({ name: itemName });
  if (!item) {
    console.error('找不到道具庫項目:', itemName);
    await client.close();
    process.exit(1);
  }

  let prog = await db.collection('progress').findOne({ playerId: discordId });
  if (!prog) prog = { playerId: discordId, level: 1, exp: 0, equipment: {}, inventory: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  if (!Array.isArray(prog.inventory)) prog.inventory = [];

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
    grantedBy: 'admin-script'
  };

  prog.inventory.push(entry);
  prog.updatedAt = new Date().toISOString();

  await db.collection('progress').updateOne({ playerId: discordId }, { $set: prog }, { upsert: true });
  console.log('已發放給 discordId:', discordId, 'uuid:', entry.uuid);

  await client.close();
}

run().catch(e => { console.error(e); process.exit(1); });
