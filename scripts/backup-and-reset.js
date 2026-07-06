require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

async function run() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME || "equipment_game";
  if (!uri) {
    console.error("MONGODB_URI is not set in environment");
    process.exit(1);
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(dbName);

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.resolve(__dirname, `../exports/db-backup-${ts}`);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Backing up database '${dbName}' to ${outDir}`);
  const cols = await db.listCollections().toArray();
  for (const c of cols) {
    const name = c.name;
    try {
      const docs = await db.collection(name).find({}).toArray();
      const outPath = path.join(outDir, `${name}.json`);
      fs.writeFileSync(outPath, JSON.stringify(docs, null, 2), "utf8");
      console.log(`  - ${name}: ${docs.length} docs -> ${outPath}`);
    } catch (e) {
      console.error(`Failed to export collection ${name}:`, e.message);
    }
  }

  // Dry-run summary of changes
  console.log("\nPlanned reset actions (dry-run):");
  console.log("  1) progress: reset levels/exp/attributes, clear equipment, filter inventory to remove equipment items");
  console.log("  2) wallets: set gold = 100 (leave diamond unchanged)");
  console.log("  3) transactions: DELETE all transactions where currencyType != 'diamond' (preserve diamond transactions)");

  const doIt = process.argv.includes("--yes") || process.argv.includes("-y");
  if (!doIt) {
    console.log("\nNo --yes flag provided. Exiting without changes. To run, re-run with --yes");
    await client.close();
    process.exit(0);
  }

  console.log("\n--yes provided: performing reset now...");

  // 1) progress update
  const progResult = await db.collection("progress").updateMany({}, [
    {
      $set: {
        level: 1,
        exp: 0,
        jobLevel: 1,
        statusPoints: 0,
        attributes: { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 },
        equipment: {
          head_top: null,
          head_mid: null,
          head_low: null,
          armor: null,
          weapon: null,
          shield: null,
          garment: null,
          shoes: null,
          accessory_l: null,
          accessory_r: null,
          title_eq: null,
          job_eq: null,
          special_1: null,
          special_2: null,
          special_3: null
        },
        inventory: {
          $filter: {
            input: "$inventory",
            as: "item",
            cond: { $ne: ["$$item.itemType", "equipment"] }
          }
        },
        // 賽季重製：清空主線劇情進度 → 序章回到未完成，下次登入自動強制重看
        storyProgress: { completed: {} },
        updatedAt: new Date().toISOString()
      }
    }
  ]);
  console.log(`progress.modifiedCount: ${progResult.modifiedCount}`);

  // 2) wallets: set gold to 100 (leave diamonds intact)
  const walletResult = await db.collection("wallets").updateMany({}, { $set: { gold: 100, updatedAt: new Date().toISOString() } });
  console.log(`wallets.modifiedCount: ${walletResult.modifiedCount}`);

  // 3) transactions: remove non-diamond transactions
  const txDelResult = await db.collection("transactions").deleteMany({ $or: [ { currencyType: { $exists: false } }, { currencyType: { $ne: "diamond" } } ] });
  console.log(`transactions.deletedCount (non-diamond): ${txDelResult.deletedCount}`);

  await client.close();
  console.log("Reset complete. Backup folder:", outDir);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
