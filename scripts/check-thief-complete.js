const { MongoClient } = require("mongodb");

const MONGO_URL = "mongodb://localhost:27017";
const DB_NAME = "equipment_game";

async function main() {
  const client = new MongoClient(MONGO_URL);
  try {
    await client.connect();
    const db = client.db(DB_NAME);

    const jobsCol = db.collection("items");
    const thiefJob = await jobsCol.findOne({ name: { $regex: "盜賊", $options: "i" } });

    if (!thiefJob) {
      console.log("❌ 找不到盜賊");
      return;
    }

    console.log("盜賊職業完整信息：\n");
    console.log(JSON.stringify(thiefJob, null, 2));
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error("❌ 錯誤:", err.message);
  process.exit(1);
});
