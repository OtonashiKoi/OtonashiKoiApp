const { MongoClient } = require("mongodb");

const MONGO_URL = "mongodb://localhost:27017";
const DB_NAME = "equipment_game";

async function main() {
  const client = new MongoClient(MONGO_URL);
  try {
    await client.connect();
    const db = client.db(DB_NAME);

    const jobsCol = db.collection("items");
    const mageJob = await jobsCol.findOne({ name: { $regex: "法師", $options: "i" } });

    if (!mageJob) {
      console.log("❌ 找不到法師職業");
      return;
    }

    console.log("📊 法師職業信息：");
    console.log(JSON.stringify(mageJob, null, 2).slice(0, 2000));
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error("❌ 錯誤:", err.message);
  process.exit(1);
});
