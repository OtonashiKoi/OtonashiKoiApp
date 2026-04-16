const { MongoClient } = require("mongodb");

async function checkMonsters() {
  const client = new MongoClient("mongodb+srv://otonashikoi1228:yikppfWQyBBIa8N9@cluster0.98efz0z.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0");
  try {
    await client.connect();
    const db = client.db("equipment_game");
    const monstersCol = db.collection("monsters");

    // 檢查所有 normal zone 的怪物
    const allMonsters = await monstersCol.find({ zone: "normal" }).toArray();
    console.log(`找到 ${allMonsters.length} 隻 normal zone 怪物:\n`);
    allMonsters.forEach(m => {
      console.log(`- seq=${m.seq} | ${m.name} | id=${m.id}`);
    });
  } finally {
    await client.close();
  }
}

checkMonsters().catch(console.error);
