#!/usr/bin/env node
/**
 * 直接MongoDB玩家数据重置工具
 */

require("dotenv").config();
const { MongoClient } = require("mongodb");
const readline = require("readline");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "equipment_game";
const SPECIAL_ITEM_TYPES = ["collectible", "special_equipment"];

async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase());
    });
  });
}

async function main() {
  if (process.env.ALLOW_LEGACY_RESET !== "1") {
    throw new Error("此為舊版資料重置工具，預設停用。賽季重置請使用 scripts/reset-players-season.js；若確定要執行舊規則，需另設 ALLOW_LEGACY_RESET=1。");
  }
  let client;
  try {
    console.log("🔗 连接到 MongoDB...");
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db(MONGODB_DB_NAME);

    const players = db.collection("players");
    const wallets = db.collection("wallets");
    const progress = db.collection("progress");
    const checkins = db.collection("checkins");
    const shopItems = db.collection("shopItems");

    // 获取特殊道具ID
    console.log("🛍️ 加载道具数据...");
    const specialItems = await shopItems
      .find({ itemType: { $in: SPECIAL_ITEM_TYPES } })
      .toArray();
    const specialItemIds = new Set(specialItems.map((item) => item.id));
    console.log(`✅ 识别 ${specialItemIds.size} 个特殊道具\n`);

    // 获取所有玩家
    console.log("📋 获取玩家列表...");
    const allPlayers = await players.find({}).toArray();
    console.log(`✅ 找到 ${allPlayers.length} 个玩家\n`);

    // 统计过去7天打卡（从当天00:00开始算起）
    console.log("📅 统计打卡...");
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);
    cutoffDate.setHours(0, 0, 0, 0); // 重置为当天00:00:00

    const checkinCounts = {};
    const allCheckins = await checkins
      .find({ occurredAt: { $gte: cutoffDate.toISOString() } })
      .toArray();

    for (const c of allCheckins) {
      checkinCounts[c.discordId] = (checkinCounts[c.discordId] || 0) + 1;
    }

    console.log(`✅ 过去7天共 ${allCheckins.length} 条打卡\n`);

    // 显示预览
    console.log("=" + "=".repeat(79));
    console.log("📊 重置预览");
    console.log("=" + "=".repeat(79));
    console.log(`将重置 ${allPlayers.length} 个玩家的数据\n`);

    console.log("每个玩家将获得:");
    console.log("  • 金币: 打卡天数 × 100 + 100");
    console.log("  • 钻石: 0 (目前未指定tier分配逻辑)");
    console.log("  • 等级: 1");
    console.log("  • 属性: str=1, agi=1, vit=1, int=1, dex=1, luk=1");
    console.log("  • 道具: 仅保留特殊道具\n");

    console.log("前5个玩家示例:");
    for (let i = 0; i < Math.min(5, allPlayers.length); i++) {
      const p = allPlayers[i];
      const checkinCount = checkinCounts[p.discordId] || 0;
      console.log(
        `  ${i + 1}. ${p.displayName}: ${checkinCount}天 → ${checkinCount * 100 + 100}金币`
      );
    }

    console.log("\n⚠️  警告：此操作将：");
    console.log("   • 删除所有普通道具");
    console.log("   • 清空钻石");
    console.log("   • 重置等级和属性");
    console.log("   无法撤销！\n");

    const answer = await prompt("确认执行？输入 'yes' 继续: ");
    if (answer !== "yes") {
      console.log("❌ 已取消");
      process.exit(0);
    }

    // 执行重置
    console.log("\n🔄 执行重置...\n");

    let count = 0;
    for (const player of allPlayers) {
      try {
        const discordId = player.discordId;
        const checkinCount = checkinCounts[discordId] || 0;
        const goldAmount = checkinCount * 100 + 100;

        // 重置钱包
        await wallets.updateOne(
          { playerId: discordId },
          {
            $set: {
              playerId: discordId,
              gold: goldAmount,
              diamond: 0,
              updatedAt: new Date().toISOString(),
            },
          },
          { upsert: true }
        );

        // 重置进度
        const playerProgress = await progress.findOne({ playerId: discordId });

        if (playerProgress) {
          const cleanedInventory = (playerProgress.inventory || []).filter(
            (item) => specialItemIds.has(item.id)
          );

          const cleanedEquipment = {};
          if (playerProgress.equipment) {
            for (const [slot, item] of Object.entries(playerProgress.equipment)) {
              if (item && specialItemIds.has(item.id)) {
                cleanedEquipment[slot] = item;
              }
            }
          }

          await progress.updateOne(
            { playerId: discordId },
            {
              $set: {
                level: 1,
                exp: 0,
                attributes: {
                  str: 1,
                  agi: 1,
                  vit: 1,
                  int: 1,
                  dex: 1,
                  luk: 1,
                },
                inventory: cleanedInventory,
                equipment: cleanedEquipment,
                allocatedPoints: 0,
                updatedAt: new Date().toISOString(),
              },
            }
          );
        } else {
          await progress.insertOne({
            playerId: discordId,
            level: 1,
            exp: 0,
            attributes: {
              str: 1,
              agi: 1,
              vit: 1,
              int: 1,
              dex: 1,
              luk: 1,
            },
            inventory: [],
            equipment: {},
            allocatedPoints: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }

        count++;
        if (count % 50 === 0) {
          process.stdout.write(`  已处理 ${count}/${allPlayers.length}\r`);
        }
      } catch (err) {
        console.error(`❌ 重置 ${player.displayName} 失败:`, err.message);
      }
    }

    console.log(`\n✅ 完成！已重置 ${count}/${allPlayers.length} 个玩家\n`);

  } catch (err) {
    console.error("❌ 错误:", err);
    process.exit(1);
  } finally {
    if (client) await client.close();
    process.exit(0);
  }
}

main();
