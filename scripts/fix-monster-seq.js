require("dotenv").config();
const { MongoClient } = require("mongodb");

async function run() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const col = client.db(process.env.MONGODB_DB_NAME || "equipment_game").collection("monsters");
  // 依目前名稱重新指定唯一 seq
  const fixes = [
    { name: "小史(小)", seq: 1 },
    { name: "哥布林",   seq: 2 },
    { name: "野狼",     seq: 3 },
    { name: "食人妖",   seq: 4 },
    { name: "石像鬼",   seq: 5 },
    { name: "黑騎士",   seq: 6 },
    { name: "龍族幼龍", seq: 7 },
  ];
  for (const { name, seq } of fixes) {
    const r = await col.updateOne({ name }, { $set: { seq } });
    console.log(`${name} → seq ${seq}  (matched: ${r.matchedCount})`);
  }
  await client.close();
}

run().catch((e) => { console.error(e.message); process.exit(1); });
