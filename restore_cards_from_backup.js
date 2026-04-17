const { MongoClient } = require('mongodb');
require('dotenv').config();

async function main() {
  const items = require('./db-backup/items.json');
  const cards = items.filter(i => i.name && i.name.includes('卡'));

  console.log(`備份中找到 ${cards.length} 張卡片：`);
  cards.forEach(c => console.log(`  - ${c.name} (${c.itemType}, ${c.equipSlot})`));

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME);

  // 先確認資料庫中有哪些
  const existing = await db.collection('items').find({
    $or: [{ name: { $regex: '卡$' } }, { equipSlot: 'special_1' }, { itemType: 'monster_card' }]
  }).toArray();
  console.log(`\n資料庫現有卡片: ${existing.length} 張`);

  // 逐一 upsert（以 id 為主鍵）
  let inserted = 0, updated = 0;
  for (const card of cards) {
    const r = await db.collection('items').updateOne(
      { id: card.id },
      { $set: card },
      { upsert: true }
    );
    if (r.upsertedCount) inserted++;
    else if (r.modifiedCount) updated++;
  }

  console.log(`\n✅ 新增: ${inserted} 張，更新: ${updated} 張`);

  const total = await db.collection('items').countDocuments({ name: { $regex: '卡' } });
  console.log(`資料庫卡片總數: ${total} 張`);

  await client.close();
}
main().catch(console.error);
