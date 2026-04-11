/**
 * 修正背包 entry 的 itemId：
 * 購買道具時存的是 shopItem.id，但 sync 比對的是 itemLibrary.id，導致 tier 同步失敗。
 * 此腳本將所有背包中 itemId 指向 shopItem 的 entry 修正為 itemLibraryId，並補上 tier。
 */
require("dotenv").config();
const { MongoClient } = require("mongodb");

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME || "equipment_game";
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  // 1. 建立 shopItemId → itemLibraryId + tier 的對照表
  const shopItems = await db.collection("shopItems").find({}).toArray();
  const shopMap = new Map(); // shopItem.id → { libraryId, tier }
  for (const s of shopItems) {
    if (s.itemLibraryId) shopMap.set(s.id || s._id?.toString(), { libraryId: s.itemLibraryId, tier: s.tier || null });
  }

  // 2. 建立 itemLibrary id → tier 對照表
  const libItems = await db.collection("items").find({}).toArray();
  const libMap = new Map(); // id → tier
  for (const l of libItems) {
    libMap.set(l.id || l._id?.toString(), l.tier || null);
  }

  console.log(`shopItems: ${shopMap.size}, libItems: ${libMap.size}`);

  // 3. 掃描所有 progress，修正 inventory
  const progColl = db.collection("progress");
  const allProg = await progColl.find({}).toArray();

  let totalFixed = 0;
  for (const prog of allProg) {
    let dirty = false;
    const inv = prog.inventory || [];
    for (const entry of inv) {
      const sid = entry.itemId;
      if (!sid) continue;
      // 如果 itemId 是 shopItem 的 id（在 libMap 找不到，但在 shopMap 找得到）
      if (!libMap.has(sid) && shopMap.has(sid)) {
        const { libraryId, tier } = shopMap.get(sid);
        console.log(`  fix: ${prog.discordId} | ${entry.itemName} | shopId ${sid} → libId ${libraryId} | tier ${entry.tier} → ${libMap.get(libraryId) ?? tier}`);
        entry.itemId = libraryId;
        entry.tier = libMap.get(libraryId) ?? tier;
        dirty = true;
        totalFixed++;
      }
      // 補上缺少的 tier（itemId 已正確但 tier 是 null）
      if (libMap.has(sid) && !entry.tier && libMap.get(sid)) {
        console.log(`  patch tier: ${prog.discordId} | ${entry.itemName} | tier null → ${libMap.get(sid)}`);
        entry.tier = libMap.get(sid);
        dirty = true;
        totalFixed++;
      }
    }
    if (dirty) {
      prog.updatedAt = new Date().toISOString();
      await progColl.replaceOne({ _id: prog._id }, prog);
    }
  }

  console.log(`\n完成，共修正 ${totalFixed} 個 entry。`);
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
