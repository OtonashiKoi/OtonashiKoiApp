require("dotenv").config();
const { MongoClient } = require("mongodb");

async function run() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db(process.env.MONGODB_DB_NAME || "equipment_game");
  const col = db.collection("wallets");
  const result = await col.updateMany(
    { gold: { $lt: 100 } },
    [{ $set: { gold: 100, updatedAt: new Date().toISOString() } }]
  );
  console.log("補齊筆數:", result.modifiedCount);
  await client.close();
}

run().catch((e) => { console.error(e.message); process.exit(1); });
