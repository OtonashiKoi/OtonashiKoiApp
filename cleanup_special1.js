const { MongoClient } = require('mongodb');
require('dotenv').config();

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME);

  const r = await db.collection('items').deleteMany({ equipSlot: 'special_1' });
  console.log('刪除 special_1 卡片:', r.deletedCount, '張');

  const remaining = await db.collection('items').find({ name: { $regex: '卡' } }).toArray();
  console.log('剩餘卡片:', remaining.length, '張');
  remaining.forEach(c => console.log(' -', c.name, '/', c.equipSlot));

  await client.close();
}
main().catch(console.error);
