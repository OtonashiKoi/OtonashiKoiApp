/**
 * 伺服器重製腳本
 * - 所有玩家回到 Lv1，屬性歸零，EXP 歸零
 * - 裝備全部移除後放入背包，背包只保留一把木製單手劍（裝備欄位）
 * - 鑽石保留
 * - 金幣重置為 100
 * - 今天的交易紀錄（transactions）全部刪除
 * - statusPoints 歸零
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');
const { randomUUID: uuidv4 } = require('crypto');

const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || 'equipment_game';

const WOODEN_SWORD_TEMPLATE = {
  itemId: "a56bd609-cf0b-4924-b724-891f221fc0b9",
  itemName: "木製單手劍",
  itemEffect: { type: "none", value: 0 },
  itemType: "equipment",
  imageUrl: "/uploads/items/7c05953f08d1de62ccf325f177a92b00.png",
  imageThumbnailUrl: "/uploads/items/7c05953f08d1de62ccf325f177a92b00_thumb.webp",
  equipSlot: "weapon",
  equipStats: { str: 3 },
  weaponType: "sword_1h",
  isTwoHanded: false,
  grantedAt: new Date().toISOString(),
  grantedBy: "server-reset-script",
  atkStat: "str",
  tier: "D",
  enhanceLevel: 0
};

const EMPTY_EQUIPMENT = {
  head_top: null, head_mid: null, head_low: null,
  armor: null, weapon: null, shield: null,
  garment: null, shoes: null,
  accessory_l: null, accessory_r: null,
  title_eq: null, job_eq: null,
  special_1: null, special_2: null, special_3: null
};

const EQUIPMENT_SLOTS = Object.keys(EMPTY_EQUIPMENT);

async function main() {
  const doIt = process.argv.includes('--yes');

  const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  const db = client.db(DB_NAME);

  const progressCol = db.collection('progress');
  const walletCol = db.collection('wallets');
  const txCol = db.collection('transactions');

  // 統計
  const totalPlayers = await progressCol.countDocuments({});
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayTxCount = await txCol.countDocuments({ createdAt: { $gte: today.toISOString() } });

  console.log(`Total players: ${totalPlayers}`);
  console.log(`Today's transactions to delete: ${todayTxCount}`);
  console.log('');

  if (!doIt) {
    console.log('Dry-run only. Add --yes to apply.');
    await client.close();
    return;
  }

  const now = new Date().toISOString();
  let resetCount = 0;
  let walletCount = 0;

  // ── 重置所有玩家 progress ──
  const allPlayers = await progressCol.find({}).toArray();
  for (const p of allPlayers) {
    // 收集所有目前裝備的物品（放回背包）
    const equippedItems = EQUIPMENT_SLOTS
      .map(slot => p.equipment?.[slot])
      .filter(item => item != null);

    // 現有背包（可能有非木劍的物品）
    const existingInventory = Array.isArray(p.inventory) ? p.inventory : [];

    // 木製單手劍（新的）
    const newSword = { ...WOODEN_SWORD_TEMPLATE, uuid: uuidv4(), grantedAt: now };

    // 新背包 = 新木劍 + 原本背包的物品 + 從裝備欄拆下的物品（去掉原本就在背包的木劍）
    // 其實只放裝備欄拆下來的東西（使用者說裝備移除後給一把木劍）
    // 鑽石保留 → 鑽石存在 wallets，不在 progress，不需處理
    const newInventory = [...equippedItems, ...existingInventory];

    // 新裝備欄：全空 + weapon = 新木劍
    const newEquipment = { ...EMPTY_EQUIPMENT, weapon: newSword };

    await progressCol.updateOne(
      { _id: p._id },
      {
        $set: {
          level: 1,
          exp: 0,
          job: 'Novice',
          jobLevel: 1,
          statusPoints: 0,
          attributes: { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 },
          equipment: newEquipment,
          inventory: newInventory,
          flags: {},
          updatedAt: now
        }
      }
    );
    resetCount++;
  }

  // ── 重置金幣（保留鑽石）──
  const walletResult = await walletCol.updateMany(
    {},
    { $set: { gold: 100, updatedAt: now } }
  );
  walletCount = walletResult.modifiedCount;

  // ── 刪除今天的交易紀錄 ──
  const txResult = await txCol.deleteMany({ createdAt: { $gte: today.toISOString() } });

  console.log(`✅ Reset ${resetCount} players (Lv1, empty equipment → inventory, new wooden sword)`);
  console.log(`✅ Reset ${walletCount} wallets to gold=100 (diamond preserved)`);
  console.log(`✅ Deleted ${txResult.deletedCount} transactions from today`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
