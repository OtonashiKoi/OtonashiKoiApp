const { MongoClient } = require("mongodb");

// Usage: MONGO_URL="mongodb://..." node scripts/check-db-collections.js
const mongoUrl = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/equipmentgame";

// Allowed collections - keep in sync with SKILL.md
const allowed = new Set([
  "monsters",
  "items",
  "effectDefinitions",
  "effect-definitions",
  "weeklyQuests",
  "monsterEvents",
  "players",
  "adminActionLogs",
  "users",
  "accounts",
]);

async function main() {
  const client = new MongoClient(mongoUrl, { useUnifiedTopology: true });
  try {
    await client.connect();
    const db = client.db();
    const collections = await db.listCollections().toArray();
    const names = collections.map((c) => c.name).sort();
    console.log("Collections in DB:", names);

    const unexpected = names.filter((n) => !allowed.has(n));
    if (unexpected.length > 0) {
      console.error("Unexpected collections found:", unexpected);
      console.error("Allowed collections:", Array.from(allowed).sort());
      process.exitCode = 2;
      return;
    }

    // Optionally list top-level keys for each allowed collection
    for (const name of names) {
      const doc = await db.collection(name).findOne({}, { projection: { _id: 0 } });
      if (doc) {
        console.log(`Top-level keys for ${name}:`, Object.keys(doc));
      } else {
        console.log(`No documents in ${name}`);
      }
    }

    console.log("DB collections match the allowed list.");
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main();
