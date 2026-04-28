const { MongoClient } = require("mongodb");
const fs = require("fs");
const path = require("path");

const MONGO_URL = "mongodb://localhost:27017";
const DB_NAME = "equipment_game";
const backupDir = path.resolve(__dirname, "../backups");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
const backupPath = path.join(backupDir, `equipment_game_${timestamp}.json`);

if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

async function main() {
  const client = new MongoClient(MONGO_URL);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    
    const collections = await db.listCollections().toArray();
    const backup = {};

    for (const col of collections) {
      const colName = col.name;
      const data = await db.collection(colName).find({}).toArray();
      backup[colName] = data;
      console.log(`✅ ${colName}: ${data.length} 筆`);
    }

    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    const fileSize = (fs.statSync(backupPath).size / 1024 / 1024).toFixed(2);
    console.log(`\n✅ 備份完成: ${backupPath} (${fileSize} MB)`);
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error("❌ 備份失敗:", err.message);
  process.exit(1);
});
