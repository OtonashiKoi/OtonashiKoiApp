require("dotenv").config();
const { MongoClient } = require("mongodb");

MongoClient.connect(process.env.MONGODB_URI).then(async (c) => {
  const db = c.db("equipment_game");
  const r = await db.collection("wallets").updateMany({}, [
    { $set: { gold: { $add: [{ $ifNull: ["$gold", 0] }, 100] } } }
  ]);
  console.log("matched:", r.matchedCount, "modified:", r.modifiedCount);
  await c.close();
}).catch(e => { console.error(e); process.exit(1); });
