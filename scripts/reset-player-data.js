#!/usr/bin/env node
/**
 * 批量玩家数据重置工具
 * 功能：清除道具、重置金币/钻石、重置等级和属性
 *
 * 用法: node scripts/reset-player-data.js [options]
 * 选项:
 *   --dry-run     预览受影响玩家，不执行修改
 *   --tier C|B|A  仅重置指定等级的玩家 (默认: 所有)
 *   --confirm     跳过确认提示
 */

require("dotenv").config();
const { MongoClient } = require("mongodb");
const readline = require("readline");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "equipment_game";

const TIER_RANKS = ["E", "D", "C", "B", "A", "S", "SS"];
const SPECIAL_ITEM_TYPES = ["collectible", "special_equipment"];

// 命令行参数
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const confirmSkip = args.includes("--confirm");
const tierFilter = args.find(a => a.startsWith("--tier="))?.split("=")[1];

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

async function getPlayerCheckinCount(checkinCollection, discordId, daysAgo = 7) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysAgo);

  const count = await checkinCollection.countDocuments({
    discordId,
    occurredAt: { $gte: cutoffDate },
  });
  return count;
}

// 使用REST API批量查询玩家角色（更快）
async function getPlayerTierByRoleQuery(memberRestManager, discordId, tierRoleToRankMap) {
  try {
    const member = await memberRestManager.fetch(discordId);
    if (!member.roles) return null;

    const memberRoleIds = member.roles || [];
    for (const rank of [...TIER_RANKS].reverse()) {
      if (memberRoleIds.some((roleId) => tierRoleToRankMap[roleId] === rank)) {
        return rank;
      }
    }
    return null;
  } catch (_) {
    return null;
  }
}

async function main() {
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
      playerTiers: db.collection("playerTiers"),
    };

    // 优化：使用缓存的 tier 配置而不是查询 Discord（太慢）
    // 从 tierConfigDoc 中直接反解玩家角色映射
    const tierRoleToRankMap = {};
    if (tierConfigDoc?.value) {
      for (const [rank, tierData] of Object.entries(tierConfigDoc.value)) {
        if (Array.isArray(tierData.roleIds)) {
          for (const roleId of tierData.roleIds) {
            tierRoleToRankMap[roleId] = rank;
          }
        }
      }
    }

    console.log(`✅ 建立 Tier 映射表\n`);

    // 注：不初始化 Discord 客户端以加速处理
    let discordClient = null;
    let guildId = null;

    // 获取所有玩家
    console.log("📋 获取玩家列表...");
    const allPlayers = await collections.players.find({}).toArray();
    console.log(`✅ 找到 ${allPlayers.length} 个玩家\n`);

    // 获取 Tier 配置
    console.log("🎖️ 加载 Tier 配置...");
    const tierConfigDoc = await collections.playerTiers.findOne({ _id: "default" });
    console.log(`✅ Tier 配置已加载\n`);

    // 获取商店数据以识别特殊道具
    console.log("🛍️ 加载道具数据...");
    const allItems = await collections.shopItems.find({}).toArray();
    const specialItemIds = new Set(
      allItems
        .filter((item) => SPECIAL_ITEM_TYPES.includes(item.itemType))
        .map((item) => item.id)
    );
    console.log(`✅ 识别 ${specialItemIds.size} 个特殊道具\n`);

    // 构建重置计划
    const plan = [];

    for (const player of allPlayers) {
      const discordId = player.discordId;
      const displayName = player.displayName || "Unknown";

      // 获取玩家等级
      const tier = await getPlayerTierFromRoles(
        tierConfigDoc,
        discordClient,
        discordId,
        guildId
      );

      // 如果指定了 tier 过滤，跳过不匹配的玩家
      if (tierFilter && tier !== tierFilter.toUpperCase()) continue;

      // 获取打卡数
      const checkinCount = await getPlayerCheckinCount(
        collections.checkins,
        discordId,
        7
      );

      // 计算新的钻石数
      let diamondAmount = 0;
      if (tier === "A" || tier === "S" || tier === "SS") diamondAmount = 10;
      else if (tier === "B") diamondAmount = 3;
      else if (tier === "C") diamondAmount = 1;
      // UNKNOWN 和其他等级: 0 钻石

      plan.push({
        discordId,
        displayName,
        tier: tier || "UNKNOWN",
        checkinCount,
        newCoin: checkinCount * 100 + 100,
        newDiamond: diamondAmount,
      });
    }

    // 显示预览
    console.log("=" + "=".repeat(79));
    console.log("📊 重置预览");
    console.log("=" + "=".repeat(79));
    console.log(
      `将重置 ${plan.length} 个玩家的数据：\n`
    );

    const summary = {};
    for (const p of plan) {
      summary[p.tier] = (summary[p.tier] || 0) + 1;
    }
    console.log("按等级分布:");
    for (const [tier, count] of Object.entries(summary).sort()) {
      console.log(`  ${tier}: ${count} 个`);
    }

    console.log("\n前 10 个玩家:");
    plan.slice(0, 10).forEach((p, i) => {
      console.log(
        `  ${i + 1}. ${p.displayName} (${p.discordId})`
      );
      console.log(
        `     等级: ${p.tier} | 打卡: ${p.checkinCount} 天 | 金币: ${p.newCoin} | 钻石: ${p.newDiamond}`
      );
    });

    if (plan.length > 10) {
      console.log(`  ... 和 ${plan.length - 10} 个其他玩家\n`);
    }

    if (dryRun) {
      console.log(
        "\n✅ 预览完成（--dry-run 模式，未执行修改）\n"
      );
      process.exit(0);
    }

    // 确认
    if (!confirmSkip) {
      console.log("\n⚠️  警告：此操作将：");
      console.log(
        "   • 删除所有普通道具（保留收藏品和特殊装备）"
      );
      console.log("   • 清空所有金币和钻石");
      console.log("   • 重置所有等级到 1");
      console.log(
        "   • 重置所有属性值为 1\n"
      );

      const answer = await prompt("确认执行？请输入 'yes' 继续: ");
      if (answer !== "yes") {
        console.log("❌ 已取消");
        process.exit(0);
      }
    }

    // 执行重置
    console.log("\n🔄 执行重置...\n");

    let resetCount = 0;
    for (const p of plan) {
      try {
        // 重置钱包
        await collections.wallets.updateOne(
          { playerId: p.discordId },
          {
            $set: {
              playerId: p.discordId,
              gold: p.newCoin,
              diamond: p.newDiamond,
              updatedAt: new Date().toISOString(),
            },
          },
          { upsert: true }
        );

        // 重置进度（等级、属性、道具）
        const progress = await collections.progress.findOne({
          playerId: p.discordId,
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
            { playerId: p.discordId },
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
            playerId: p.discordId,
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
        if (resetCount % 10 === 0) {
          process.stdout.write(`  已处理 ${resetCount}/${plan.length} 个玩家\r`);
        }
      } catch (err) {
        console.error(
          `❌ 重置 ${p.displayName} (${p.discordId}) 失败:`,
          err.message
        );
      }
    }

    console.log(
      `\n✅ 重置完成！已处理 ${resetCount}/${plan.length} 个玩家\n`
    );

    // 统计信息
    console.log("=" + "=".repeat(79));
    console.log("📈 重置统计");
    console.log("=" + "=".repeat(79));
    console.log(`总玩家数: ${resetCount}`);
    console.log("等级分布:");
    for (const [tier, count] of Object.entries(summary).sort()) {
      console.log(`  ${tier}: ${count} 个`);
    }
    console.log();
  } catch (err) {
    console.error("❌ 错误:", err);
    process.exit(1);
  } finally {
    if (client) await client.close();
    process.exit(0);
  }
}

main();
