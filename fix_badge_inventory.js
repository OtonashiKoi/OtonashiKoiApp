const { MongoClient } = require("mongodb");

async function main() {
  const client = new MongoClient("mongodb://localhost:27017");
  await client.connect();
  const db = client.db("equipment_game");
  
  // 查詢所有有職業徽章但沒有 equipSlot 的玩家
  const badgeMappings = {
    "job_swordsman_v1": "劍士徽章",
    "job_archer_v1": "弓箭手徽章",
    "job_warrior_v1": "戰士徽章",
    "job_healer_v1": "治療師徽章",
    "job_mage_v1": "法師徽章",
    "job_rogue_v1": "盜賊徽章",
    "job_dwarf_warrior_v1": "矮人戰士徽章"
  };
  
  // 為所有職業徽章添加 equipSlot
  for (const [badgeId, badgeName] of Object.entries(badgeMappings)) {
    const result = await db.collection("progress").updateMany(
      { 
        "inventory.itemId": badgeId,
        "inventory.equipSlot": null 
      },
      [
        {
          $set: {
            "inventory": {
              $map: {
                input: "$inventory",
                as: "item",
                in: {
                  $cond: [
                    { $eq: ["$$item.itemId", badgeId] },
                    { ...{ ...null }, ...{ equipSlot: "job_eq" }, "$$item": 0 },
                    "$$item"
                  ]
                }
              }
            }
          }
        }
      ]
    );
  }
  
  // 使用更簡單的方法
  const progress = await db.collection("progress").find({}).toArray();
  let fixCount = 0;
  
  for (const p of progress) {
    let changed = false;
    if (Array.isArray(p.inventory)) {
      for (const item of p.inventory) {
        if (item.itemType === "job_badge" && !item.equipSlot) {
          item.equipSlot = "job_eq";
          changed = true;
          fixCount++;
        }
      }
    }
    if (changed) {
      await db.collection("progress").updateOne({ _id: p._id }, { $set: { inventory: p.inventory } });
    }
  }
  
  console.log(`已修復 ${fixCount} 個職業徽章的 equipSlot`);
  
  await client.close();
}

main().catch(console.error);
