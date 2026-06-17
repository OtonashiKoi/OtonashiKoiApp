require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { slimInventoryArray } = require("../src/shared/inventoryStorage");
const bson = require("bson");
(async () => {
  const db = await getMongoDb();
  const cur = db.collection("progress").find({ "inventory.0": { $exists: true } });
  let scanned = 0, updated = 0, biggestBefore = 0, biggestAfter = 0;
  while (await cur.hasNext()) {
    const p = await cur.next();
    scanned++;
    const before = bson.serialize(p).length;
    const slim = slimInventoryArray(p.inventory);
    const after = bson.serialize({ ...p, inventory: slim }).length;
    if (after < before) {
      await db.collection("progress").updateOne({ _id: p._id }, { $set: { inventory: slim } });
      updated++;
      if (before > biggestBefore) { biggestBefore = before; biggestAfter = after; }
    }
  }
  console.log(`scanned=${scanned} updated=${updated}`);
  console.log(`biggest doc: ${(biggestBefore/1024/1024).toFixed(2)}MB -> ${(biggestAfter/1024/1024).toFixed(2)}MB`);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
