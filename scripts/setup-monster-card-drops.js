const { MongoClient } = require("mongodb");

async function setupDrops() {
  const client = new MongoClient("mongodb://localhost:27017");
  try {
    await client.connect();
    const db = client.db("equipment_game");
    
    const initialMonsters = [
      { id: "c39bdddd-a33d-4e34-8019-d17020a8083b", name: "小史(小)" },
      { id: "f00fd7b1-9f57-4532-9901-f4d4d74f132d", name: "哥布" },
      { id: "a8ef443e-3a0d-4ccb-9290-d6394edaa59f", name: "小狼" },
      { id: "2d226eea-934a-4787-8ff7-9f19d12ac590", name: "石頭" },
      { id: "03c93103-eddb-4265-96ca-a8a76bb82a02", name: "小金(稀)" },
      { id: "6f321e26-e74e-4a05-a55a-6145da53373d", name: "青草地精" },
      { id: "a1ab762c-cd0b-4270-994b-74b68c242840", name: "綠野狼" }
    ];

    console.log("為每隻怪物添加卡片掉落...\n");
    
    for (const monster of initialMonsters) {
      // 從 monsterCards 取得對應卡片
      const card = await db.collection("monsterCards").findOne({ name: monster.name });
      
      if (card) {
        // 將卡片 ID 轉為字串格式，作為掉落物品 ID
        const cardItemId = `monster-card-${card.card_id}`;
        
        // 更新怪物掉落表，添加卡片掉落
        const result = await db.collection("monsters").updateOne(
          { id: monster.id },
          { 
            $push: { 
              drops: { 
                itemId: cardItemId, 
                chance: 3 
              } 
            }
          }
        );
        
        console.log(`✅ ${monster.name} - 添加卡片掉落 3%`);
      } else {
        console.log(`⚠️  ${monster.name} - 卡片未找到`);
      }
    }
    
    console.log(`\n完成！`);
  } finally {
    await client.close();
  }
}

setupDrops().catch(console.error);
