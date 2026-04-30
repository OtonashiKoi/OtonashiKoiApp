require("dotenv").config();
const { MongoClient } = require("mongodb");

const MONGO_URL = process.env.MONGODB_URI || "mongodb://localhost:27017";
const DB_NAME = process.env.MONGODB_DB_NAME || "equipment_game";
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

function getTaipeiWeekStartIso(now = new Date()) {
  const taipeiNow = new Date(now.getTime() + TAIPEI_OFFSET_MS);
  const day = taipeiNow.getUTCDay(); // 0 = Sunday, 1 = Monday ...
  const daysSinceMonday = (day + 6) % 7;
  taipeiNow.setUTCDate(taipeiNow.getUTCDate() - daysSinceMonday);
  taipeiNow.setUTCHours(0, 0, 0, 0);
  const weekStartUtc = new Date(taipeiNow.getTime() - TAIPEI_OFFSET_MS);
  return weekStartUtc.toISOString();
}

async function main() {
  const client = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 5000 });
  const cutoff = getTaipeiWeekStartIso();

  try {
    await client.connect();
    const db = client.db(DB_NAME);

    const collection = db.collection("transactions");
    const beforeCount = await collection.countDocuments({ createdAt: { $exists: true, $lt: cutoff } });
    console.log(`[transactions] cutoff=${cutoff}`);
    console.log(`[transactions] candidates=${beforeCount}`);

    const result = await collection.deleteMany({ createdAt: { $exists: true, $lt: cutoff } });
    console.log(`[transactions] deleted=${result.deletedCount}`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("[transactions] prune failed:", err.message);
  process.exit(1);
});
