const { MongoClient } = require("mongodb");

async function checkStructure() {
  const client = new MongoClient("mongodb://localhost:27017");
  try {
    await client.connect();
    const db = client.db("equipment_game");
    
    const allCards = await db.collection("monsterCards").find({}).limit(2).toArray();
    
    if (allCards.length > 0) {
      console.log("✅ monsterCards collection 存在\n");
      console.log("卡片結構示例:");
      console.log(JSON.stringify(allCards[0], null, 2));
    } else {
      console.log("❌ monsterCards collection 為空");
      
      // 查詢 items 中是否有卡片類型的物品
      console.log("\n查詢 items collection 中的卡片...\n");
      const cards = await db.collection("items").find({ itemType: "card" }).limit(3).toArray();
      console.log(`找到 ${cards.length} 張卡片`);
      if (cards.length > 0) {
        console.log("\n卡片示例:");
        console.log(JSON.stringify(cards[0], null, 2));
      }
    }
  } finally {
    await client.close();
  }
}

checkStructure().catch(console.error);
