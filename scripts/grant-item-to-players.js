require('dotenv').config();
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

const TARGET_NAMES = [
  '喜歡跳烤爐的咩',
  '享受夢境',
  '餅乾oao',
  '布布',
  'B.Y',
  '滷灰灰',
  '大史(B)',
  'kxcdzov',
  '音無恋'
];

async function run() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME || 'equipment_game';
  if (!uri) throw new Error('MONGODB_URI not set');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(dbName);

  // 找道具庫項目 by name
  const itemName = '樂園CCB勇者';
  const item = await db.collection('items').findOne({ name: itemName });
  if (!item) {
    console.error('找不到道具庫項目:', itemName);
    await client.close();
    process.exit(1);
  }

  const results = [];
  for (const name of TARGET_NAMES) {
    // 嘗試以 displayName 精確配對，若失敗則以 streamAliases 含有項目配對
    const player = await db.collection('players').findOne({ $or: [ { displayName: name }, { streamAliases: name } ] });
    if (!player) {
      results.push({ name, ok: false, reason: 'player not found' });
      continue;
    }
    const discordId = player.discordId;
    // 讀取或建立 progress
    let prog = await db.collection('progress').findOne({ playerId: discordId });
    if (!prog) {
      prog = { playerId: discordId, level: 1, exp: 0, equipment: {}, inventory: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    }
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
    results.push({ name, ok: true, discordId, uuid: entry.uuid });
  }

  console.log('結果：');
  for (const r of results) console.log(r);

  await client.close();
}

run().catch(e => { console.error(e); process.exit(1); });
