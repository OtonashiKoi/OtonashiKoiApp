"use strict";
/**
 * 給所有 lv>=2 玩家發 1 罐屬性重製藥水，並在 town_chat 頻道發公告。
 *
 * 執行：node scripts/grant-reroll-potion-and-announce.js
 * 加 --dry-run 只列印不執行
 */

require("dotenv").config();
const { MongoClient } = require("mongodb");
const crypto = require("crypto");
const { Client, GatewayIntentBits } = require("discord.js");

const MONGO_URL = process.env.MONGO_URL || "mongodb://localhost:27017";
const DB_NAME = "equipment_game";
const REROLL_ITEM_ID = "87b281be-b175-40a0-8044-0accc88a0ee0";
const isDryRun = process.argv.includes("--dry-run");

const ANNOUNCE_TEXT =
`🔧 **屬性點數問題 BUG 暫時修正**

之前升等時偶發性多領 / 漏領屬性點的問題已修正。
為補償受影響的玩家，**所有 Lv.2 以上的玩家都收到一罐 🔮 屬性重製藥水**，可在背包中使用，重新分配你的屬性！

如果還有任何屬性異常或其他問題，歡迎隨時告訴我 🙏`;

async function main() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  const db = client.db(DB_NAME);

  // 取得 reroll 藥水道具完整資料
  const item = await db.collection("items").findOne({ id: REROLL_ITEM_ID });
  if (!item) throw new Error("找不到屬性重製藥水道具");

  const players = await db.collection("progress").find({ level: { $gte: 2 } }).toArray();
  console.log(`找到 ${players.length} 位 lv>=2 玩家`);

  let granted = 0;
  let stacked = 0;
  for (const p of players) {
    const inv = Array.isArray(p.inventory) ? p.inventory : [];
    const existing = inv.find(e => e.itemId === REROLL_ITEM_ID);

    if (existing) {
      // 已有藥水 → stackCount + 1
      const newCount = (existing.stackCount || 1) + 1;
      if (!isDryRun) {
        await db.collection("progress").updateOne(
          { _id: p._id, "inventory.uuid": existing.uuid },
          {
            $set: {
              "inventory.$.stackCount": newCount,
              updatedAt: new Date().toISOString()
            }
          }
        );
      }
      stacked++;
    } else {
      // 新增一筆
      const newEntry = {
        uuid: crypto.randomUUID(),
        itemId: item.id,
        itemName: item.name,
        itemEffect: item.effect || { type: "none", value: 0 },
        useEffects: item.useEffects || [],
        passiveEffects: item.passiveEffects || [],
        procEffects: item.procEffects || [],
        combatEffects: item.combatEffects || [],
        itemType: item.itemType || "consumable",
        imageUrl: item.imageUrl || null,
        imageThumbnailUrl: item.imageThumbnailUrl || null,
        equipSlot: item.equipSlot || null,
        equipStats: item.equipStats || null,
        weaponType: item.weaponType || null,
        isTwoHanded: false,
        tier: item.tier || null,
        stackCount: 1,
        grantedAt: new Date().toISOString(),
        grantedBy: "compensation:attribute-bug-fix"
      };
      if (!isDryRun) {
        await db.collection("progress").updateOne(
          { _id: p._id },
          {
            $push: { inventory: newEntry },
            $set: { updatedAt: new Date().toISOString() }
          }
        );
      }
      granted++;
    }
  }

  console.log(`發放完成：新增 ${granted} 罐、堆疊 ${stacked} 罐`);
  if (isDryRun) {
    console.log("(dry-run，未實際寫入)");
    await client.close();
    return;
  }

  // 找 town_chat 頻道並發公告
  const layout = await db.collection("channelLayout").findOne({ _id: "default" });
  const bindings = layout?.value?.discord?.bindings || [];
  const townBinding = bindings.find(b => b.enabled && b.channelId && b.featureKey === "town_chat");
  if (!townBinding?.channelId) {
    console.warn("⚠ 找不到 town_chat 頻道綁定，公告未發送");
    await client.close();
    return;
  }

  console.log(`town_chat channelId: ${townBinding.channelId}，連接 Discord...`);
  await client.close();

  const bot = new Client({ intents: [GatewayIntentBits.Guilds] });
  await bot.login(process.env.DISCORD_TOKEN);
  const ch = await bot.channels.fetch(townBinding.channelId).catch(() => null);
  if (!ch) {
    console.error("⚠ 無法取得頻道，公告未發送");
    await bot.destroy();
    process.exit(1);
  }
  await ch.send(ANNOUNCE_TEXT);
  console.log("✓ 公告已發送");
  await bot.destroy();
}

main().catch(e => { console.error(e); process.exit(1); });
