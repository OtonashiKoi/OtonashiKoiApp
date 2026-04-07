require("dotenv").config();
const { MongoClient } = require("mongodb");
MongoClient.connect(process.env.MONGODB_URI).then(async (c) => {
  const db = c.db("equipment_game");
  const all = await db.collection("monsters").find({ name: "大史" }).sort({ _id: 1 }).toArray();
  const keepId = all[0].id;
  const deleteIds = all.slice(1).map(m => m.id);
  const r = await db.collection("monsters").deleteMany({ id: { $in: deleteIds } });
  console.log("kept:", keepId);
  console.log("deleted:", r.deletedCount);
  await c.close();
});
