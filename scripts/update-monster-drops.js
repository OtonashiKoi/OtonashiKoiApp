const { MongoClient } = require("mongodb");

const D_TIER_ITEMS = [
  "33d319ec-cb62-4826-8bcc-82a6fe52b8fa", "d5936211-685a-4cd7-a1e9-24524725da96",
  "a91fab15-a786-490a-ae7f-6ecd536febb1", "7bdf0277-dcd5-4173-b3ff-d93ccaa9e293",
  "912125cb-6738-4694-9657-81e7f6a5c2da", "ee883bee-93c6-450d-b196-754d3e345d2a",
  "3667cf4f-18cb-4861-b4cb-8700805d8bcf", "4a7c2dd6-1d33-4613-a5aa-913924d12eed",
  "421196aa-83e4-4f2e-82f6-dc05077b115a", "a56bd609-cf0b-4924-b724-891f221fc0b9",
  "4885e098-3624-4c6c-9eb9-e4b27c2fb5ab", "6da9f4e6-aac1-4088-9000-7111fd4926b0",
  "d95a76a8-79ab-4dc7-ab07-82a39dbb5912", "ce6f0608-2750-47b4-aa26-14d9c1aa0f4c",
  "2271e23c-9648-430e-944b-cea2107ee8ec", "2fcf7576-4e74-4280-b1e6-0d7da7b58dda",
  "c0eb5730-e014-4286-9aac-61ba7fb38d6e", "44bda7cc-5b9e-4ce1-95cc-c4a7a413d8cf",
  "be6f16fa-4e72-47ab-9a08-d580bd5490ef", "19e24aca-92f5-4f81-8ab9-cc4f8ba73a72"
];

const INITIAL_MONSTERS = [
  "c39bdddd-a33d-4e34-8019-d17020a8083b", "f00fd7b1-9f57-4532-9901-f4d4d74f132d",
  "a8ef443e-3a0d-4ccb-9290-d6394edaa59f", "2d226eea-934a-4787-8ff7-9f19d12ac590",
  "03c93103-eddb-4265-96ca-a8a76bb82a02", "6f321e26-e74e-4a05-a55a-6145da53373d",
  "a1ab762c-cd0b-4270-994b-74b68c242840"
];

function shuffleAndPick(arr, n) {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, n);
}

async function updateDrops() {
  const client = new MongoClient("mongodb://localhost:27017");
  try {
    await client.connect();
    const db = client.db("equipment_game");
    const monstersCol = db.collection("monsters");

    console.log(`🔗 連線到本地 MongoDB (localhost:27017)\n`);
    
    let updated = 0;
    for (const monsterId of INITIAL_MONSTERS) {
      const selectedItems = shuffleAndPick(D_TIER_ITEMS, 4);
      const drops = selectedItems.map(itemId => ({
        itemId,
        chance: 15
      }));

      const result = await monstersCol.updateOne(
        { id: monsterId },
        { $set: { drops, updatedAt: new Date().toISOString() } }
      );

      if (result.matchedCount > 0) {
        const monster = await monstersCol.findOne({ id: monsterId });
        console.log(`✅ ${monster.name} - 4個D階裝備 × 15%`);
        updated++;
      }
    }
    console.log(`\n✨ 完成：${updated}/7 隻怪物已更新到本地資料庫`);
  } catch (e) {
    console.error("❌ 連線失敗:", e.message);
  } finally {
    await client.close();
  }
}

updateDrops();
