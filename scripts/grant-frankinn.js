require('dotenv').config();
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

async function run() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME || 'equipment_game';
  if (!uri) throw new Error('MONGODB_URI not set');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(dbName);

  const q = 'frankinn';
  // 搜尋 displayName 或 streamAliases 包含 frankinn (case-insensitive)
  const player = await db.collection('players').findOne({
    $or: [
      { displayName: { $regex: q, $options: 'i' } },
      { streamAliases: { $elemMatch: { $regex: q, $options: 'i' } } },
      { 'externalIds.twitch': { $regex: q, $options: 'i' } }
    ]
  });

  if (!player) {
    console.log('找不到包含 frankinn 的玩家');
    await client.close();
    process.exit(0);
  }

  console.log('找到玩家：', player.displayName, player.discordId);

  const itemName = '樂園CCB勇者';
  const item = await db.collection('items').findOne({ name: itemName });
  if (!item) {
    console.error('找不到道具庫項目:', itemName);
    await client.close();
    process.exit(1);
  }

  let prog = await db.collection('progress').findOne({ playerId: player.discordId });
  if (!prog) prog = { playerId: player.discordId, inventory: [], equipment: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
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

  await db.collection('progress').updateOne({ playerId: player.discordId }, { $set: prog }, { upsert: true });
  console.log('已發放給', player.displayName, player.discordId, 'uuid:', entry.uuid);

  await client.close();
}

run().catch(e => { console.error(e); process.exit(1); });
