const { MongoClient } = require('mongodb');
require('dotenv').config();

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME);

  const allCards = await db.collection('items').find({ itemType: 'monster_card' }).toArray();
  console.log(`\n共 ${allCards.length} 張卡片：`);
  allCards.forEach(c => console.log(`  ${c.name} (tier:${c.tier})`));

  // 找出那些名稱沒有「卡」字的（我錯誤插入的）
  const wrongCards = allCards.filter(c => !c.name.includes('卡'));
  console.log(`\n需要刪除的錯誤卡片 (${wrongCards.length} 張):`);
  wrongCards.forEach(c => console.log(`  - ${c.name}`));

  if (wrongCards.length > 0) {
    const ids = wrongCards.map(c => c._id);
    const result = await db.collection('items').deleteMany({ _id: { $in: ids } });
    console.log(`\n✅ 已刪除 ${result.deletedCount} 張錯誤卡片`);
  }

  const remaining = await db.collection('items').countDocuments({ itemType: 'monster_card' });
  console.log(`\n剩餘卡片數: ${remaining}`);
  const leftCards = await db.collection('items').find({ itemType: 'monster_card' }).toArray();
  leftCards.forEach(c => console.log(`  ✅ ${c.name}`));

  await client.close();
}
main().catch(console.error);
