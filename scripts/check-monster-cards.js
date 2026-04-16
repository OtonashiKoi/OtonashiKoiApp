const { MongoClient } = require("mongodb");

async function checkCards() {
  const client = new MongoClient("mongodb://localhost:27017");
  try {
    await client.connect();
    const db = client.db("equipment_game");
    
    // 查詢所有初階怪物卡片
    const initialMonsterIds = [
      "c39bdddd-a33d-4e34-8019-d17020a8083b",
      "f00fd7b1-9f57-4532-9901-f4d4d74f132d",
      "a8ef443e-3a0d-4ccb-9290-d6394edaa59f",
      "2d226eea-934a-4787-8ff7-9f19d12ac590",
      "03c93103-eddb-4265-96ca-a8a76bb82a02",
      "6f321e26-e74e-4a05-a55a-6145da53373d",
      "a1ab762c-cd0b-4270-994b-74b68c242840"
    ];

    const monsters = await db.collection("monsters").find({ id: { $in: initialMonsterIds } }).toArray();
    
    console.log("初階怪物卡片查詢:\n");
    for (const monster of monsters) {
      console.log(`${monster.name}:`);
      console.log(`  怪物 ID: ${monster.id}`);
      console.log(`  怪物 seq: ${monster.seq}`);
      
      // 查詢對應的卡片
      const card = await db.collection("monsterCards").findOne({ monster_id: monster.id });
      if (card) {
        console.log(`  ✅ 卡片 ID: ${card._id || card.id}`);
      } else {
        console.log(`  ❌ 未找到卡片`);
      }
      console.log();
    }
  } finally {
    await client.close();
  }
}

checkCards().catch(console.error);
