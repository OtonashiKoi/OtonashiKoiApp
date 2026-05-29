require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const DISCORD_ID = "865264891991425055";
const TARGET_LEVEL = 5;

async function main() {
  const db = await getMongoDb();

  const player = await db.collection("players").findOne({ discordId: DISCORD_ID });
  if (!player) { console.error(`找不到玩家 ${DISCORD_ID}`); process.exit(1); }
  console.log(`玩家：${player.displayName || player.discordId}`);

  // progress.playerId 直接存 discordId（不是 player._id）
  const progress = await db.collection("progress").findOne({ playerId: DISCORD_ID });
  if (!progress) {
    console.error(`找不到 progress (playerId=${DISCORD_ID})`);
    process.exit(1);
  }
  await processProgress(db, progress);
}

async function processProgress(db, progress) {
  console.log(`\n當前等級: Lv.${progress.level}  ATTR: STR ${progress.attributes?.str} AGI ${progress.attributes?.agi} VIT ${progress.attributes?.vit} INT ${progress.attributes?.int} DEX ${progress.attributes?.dex} LUK ${progress.attributes?.luk}`);
  console.log(`EXP: ${progress.exp}  金幣: ${progress.gold}`);

  // 收集已裝備的物品
  const equipment = progress.equipment || {};
  const equippedSlots = Object.keys(equipment).filter((k) => equipment[k]);
  console.log(`\n已裝備 ${equippedSlots.length} 個槽位：`);
  for (const slot of equippedSlots) {
    console.log(`  ${slot}: ${equipment[slot].itemName || equipment[slot].name || equipment[slot].itemId}`);
  }

  // 把所有裝備放回背包
  const inventory = Array.isArray(progress.inventory) ? [...progress.inventory] : [];
  for (const slot of equippedSlots) {
    const item = equipment[slot];
    if (!item) continue;
    const itemId = item.itemId || item.id;
    const existing = inventory.find((inv) => (inv.itemId || inv.id) === itemId);
    if (existing) {
      existing.quantity = (existing.quantity || 1) + 1;
    } else {
      inventory.push({
        itemId,
        itemName: item.itemName || item.name,
        quantity: 1,
        ...(item.tier ? { tier: item.tier } : {}),
        ...(item.itemType ? { itemType: item.itemType } : {}),
        ...(item.equipSlot ? { equipSlot: item.equipSlot } : {}),
        ...(item.equipStats ? { equipStats: item.equipStats } : {}),
        ...(item.weaponType ? { weaponType: item.weaponType } : {}),
        ...(item.isTwoHanded != null ? { isTwoHanded: item.isTwoHanded } : {}),
      });
    }
  }

  // 重設等級、屬性、清空裝備
  const newAttributes = {
    str: 1 + (TARGET_LEVEL - 1) * 0, // 基礎 1
    agi: 1,
    vit: 1,
    int: 1,
    dex: 1,
    luk: 1,
  };
  // 升等到 Lv.5 = 4 次升級 × 2 屬性點 = 8 點隨機分配
  // 簡化：直接平均（每屬性 +1 加在隨機 2 個）
  // 為了乾淨，我給平均：6 種屬性 × 2 點 = 12 點？ 但 4 等才有 8 點. 給平均：每個 +1 (6 點) + 2 點隨機
  // 直接每個 +1 然後 STR +1 VIT +1 補到 8
  const attrPoints = (TARGET_LEVEL - 1) * 2;
  // 平均分到 6 種屬性
  const each = Math.floor(attrPoints / 6);
  const extra = attrPoints - each * 6;
  newAttributes.str += each;
  newAttributes.agi += each;
  newAttributes.vit += each;
  newAttributes.int += each;
  newAttributes.dex += each;
  newAttributes.luk += each;
  // 多的 2 點塞 STR 跟 VIT
  if (extra >= 1) newAttributes.str += 1;
  if (extra >= 2) newAttributes.vit += 1;

  const updateResult = await db.collection("progress").updateOne(
    { _id: progress._id },
    {
      $set: {
        level: TARGET_LEVEL,
        exp: 0,
        attributes: newAttributes,
        equipment: {},  // 清空裝備
        inventory,       // 卸下的裝備回背包
        updatedAt: new Date().toISOString(),
      },
    }
  );
  console.log(`\n✅ 已更新 progress`);
  console.log(`  → Lv.${TARGET_LEVEL}`);
  console.log(`  → ATTR: STR ${newAttributes.str} AGI ${newAttributes.agi} VIT ${newAttributes.vit} INT ${newAttributes.int} DEX ${newAttributes.dex} LUK ${newAttributes.luk}`);
  console.log(`  → 卸下 ${equippedSlots.length} 件裝備到背包（背包共 ${inventory.length} 種道具）`);
  console.log(`  matched=${updateResult.matchedCount}, modified=${updateResult.modifiedCount}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
