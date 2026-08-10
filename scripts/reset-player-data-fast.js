#!/usr/bin/env node
/**
 * 批量玩家数据重置工具 (快速版)
 * 功能：清除道具、重置金币/钻石、重置等级和属性
 *
 * 用法: node scripts/reset-player-data-fast.js
 *
 * 备注：此版本跳过Discord角色查询，所有玩家默认等级为UNKNOWN（0钻石）
 *      如需精确分配等级，请使用主脚本
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

    const collections = {
      players: db.collection("players"),
      wallets: db.collection("wallets"),
      progress: db.collection("progress"),
      checkins: db.collection("checkins"),
      shopItems: db.collection("shopItems"),
    };

    // 获取所有玩家
    console.log("📋 获取玩家列表...");
    const allPlayers = await collections.players.find({}).toArray();
    console.log(`✅ 找到 ${allPlayers.length} 个玩家\n`);

    // 获取商店数据以识别特殊道具
    console.log("🛍️ 加载道具数据...");
    const allItems = await collections.shopItems.find({}).toArray();
    const specialItemIds = new Set(
      allItems
        .filter((item) => SPECIAL_ITEM_TYPES.includes(item.itemType))
        .map((item) => item.id)
    );
    console.log(`✅ 识别 ${specialItemIds.size} 个特殊道具\n`);

    // 获取过去7天打卡统计
    console.log("📅 统计打卡数据...");
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);

    const checkinCounts = {};
    const allCheckins = await collections.checkins
      .find({ occurredAt: { $gte: cutoffDate } })
      .toArray();

    for (const checkin of allCheckins) {
      checkinCounts[checkin.discordId] =
        (checkinCounts[checkin.discordId] || 0) + 1;
    }
    console.log(`✅ 过去7天共 ${allCheckins.length} 条打卡记录\n`);

    // 显示预览
    console.log("=" + "=".repeat(79));
    console.log("📊 重置预览");
    console.log("=" + "=".repeat(79));
    console.log(`将重置 ${allPlayers.length} 个玩家的数据：\n`);

    console.log("每个玩家将获得:");
    console.log("  • 金币: 打卡天数 × 100 + 100");
    console.log("  • 钻石: 0 (所有玩家，因未查询Discord等级)");
    console.log("  • 等级: 1");
    console.log("  • 属性: str=1, agi=1, vit=1, int=1, dex=1, luk=1");
    console.log("  • 道具: 仅保留特殊道具\n");

    console.log("金币分布示例（前5个玩家）:");
    allPlayers.slice(0, 5).forEach((p, i) => {
      const checkinCount = checkinCounts[p.discordId] || 0;
      const goldAmount = checkinCount * 100 + 100;
      console.log(
        `  ${i + 1}. ${p.displayName} (${p.discordId}): ${checkinCount}天 → ${goldAmount}金币`
      );
    });

    console.log("\n⚠️  警告：此操作将：");
    console.log("   • 删除所有普通道具（保留特殊道具）");
    console.log("   • 清空所有钻石（设为0）");
    console.log("   • 重置所有等级到 1");
    console.log("   • 重置所有属性值为 1\n");

    const answer = await prompt("确认执行？请输入 'yes' 继续: ");
    if (answer !== "yes") {
      console.log("❌ 已取消");
      process.exit(0);
    }

    // 执行重置
    console.log("\n🔄 执行重置...\n");

    let resetCount = 0;
    for (const player of allPlayers) {
      try {
        const discordId = player.discordId;
        const checkinCount = checkinCounts[discordId] || 0;
        const goldAmount = checkinCount * 100 + 100;

        // 重置钱包
        await collections.wallets.updateOne(
          { playerId: discordId },
          {
            $set: {
              playerId: discordId,
              gold: goldAmount,
              diamond: 0, // 所有玩家都是0钻石
              updatedAt: new Date().toISOString(),
            },
          },
          { upsert: true }
        );

        // 重置进度
        const progress = await collections.progress.findOne({
          playerId: discordId,
        });

        if (progress) {
          // 清理道具：删除非特殊道具
          const cleanedInventory = (progress.inventory || []).filter((item) =>
            specialItemIds.has(item.id)
          );

          // 清理装备：删除所有装备
          const cleanedEquipment = {};
          if (progress.equipment) {
            for (const [slot, item] of Object.entries(progress.equipment)) {
              if (item && specialItemIds.has(item.id)) {
                cleanedEquipment[slot] = item;
              }
            }
          }

          await collections.progress.updateOne(
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
          // 创建新的 progress 记录
          await collections.progress.insertOne({
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

        resetCount++;
        if (resetCount % 20 === 0) {
          process.stdout.write(
            `  已处理 ${resetCount}/${allPlayers.length} 个玩家\r`
          );
        }
      } catch (err) {
        console.error(
          `❌ 重置 ${player.displayName} (${player.discordId}) 失败:`,
          err.message
        );
      }
    }

    console.log(
      `\n✅ 重置完成！已处理 ${resetCount}/${allPlayers.length} 个玩家\n`
    );

    // 统计信息
    console.log("=" + "=".repeat(79));
    console.log("📈 重置统计");
    console.log("=" + "=".repeat(79));
    console.log(`总玩家数: ${resetCount}`);
    console.log(`打卡人数: ${Object.keys(checkinCounts).length}`);
    console.log(`总打卡数: ${allCheckins.length}`);
    console.log(`保留特殊道具: ${specialItemIds.size} 个\n`);
  } catch (err) {
    console.error("❌ 错误:", err);
    process.exit(1);
  } finally {
    if (client) await client.close();
    process.exit(0);
  }
}

main();
