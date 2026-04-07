require("dotenv").config();
const { MongoClient } = require("mongodb");

MongoClient.connect(process.env.MONGODB_URI).then(async (c) => {
  const db = c.db("equipment_game");

  // ── 1. progress: 等級/EXP 歸零、屬性重置、裝備欄清空、inventory 移除 equipment 類道具 ──
  const progResult = await db.collection("progress").updateMany({}, [
    {
      $set: {
        level: 1,
        exp: 0,
        jobLevel: 1,
        statusPoints: 0,
        attributes: { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 },
        equipment: {
          head_top: null, head_mid: null, head_low: null,
          armor: null, weapon: null, shield: null,
          garment: null, shoes: null,
          accessory_l: null, accessory_r: null,
          title_eq: null, job_eq: null,
          special_1: null, special_2: null, special_3: null
        },
        inventory: {
          $filter: {
            input: "$inventory",
            as: "item",
            cond: { $ne: ["$$item.itemType", "equipment"] }
          }
        },
        updatedAt: new Date().toISOString()
      }
    }
  ]);
  console.log("progress updated:", progResult.modifiedCount);

  // ── 2. wallets: 金幣設為 100（鑽石不動）──
  const walletResult = await db.collection("wallets").updateMany({}, { $set: { gold: 100 } });
  console.log("wallets updated:", walletResult.modifiedCount);

  await c.close();
  console.log("Done.");
}).catch((e) => { console.error(e.message); process.exit(1); });
