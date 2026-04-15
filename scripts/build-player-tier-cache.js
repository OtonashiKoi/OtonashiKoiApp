#!/usr/bin/env node
/**
 * 构建玩家等级缓存
 * 快速查询所有玩家的Discord等级，保存到缓存文件
 */

require("dotenv").config();
const { MongoClient } = require("mongodb");
const fs = require("fs");
const path = require("path");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "equipment_game";
const TIER_RANKS = ["E", "D", "C", "B", "A", "S", "SS"];
const CACHE_FILE = path.join(__dirname, ".tier-cache.json");

async function main() {
  let client;
  try {
    console.log("🔗 连接到 MongoDB...");
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db(MONGODB_DB_NAME);

    // 获取玩家和Tier配置
    console.log("📋 获取数据...");
    const [allPlayers, tierConfigDoc] = await Promise.all([
      db.collection("players").find({}).toArray(),
      db.collection("playerTiers").findOne({ _id: "default" }),
    ]);

    console.log(`✅ 找到 ${allPlayers.length} 个玩家\n`);

    // 初始化Discord客户端
    console.log("🤖 初始化Discord客户端...");
    const { Client, GatewayIntentBits } = require("discord.js");
    const discordClient = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
      ],
    });

    await discordClient.login(process.env.DISCORD_TOKEN);
    const guildId = process.env.DISCORD_GUILD_ID;
    const guild = await discordClient.guilds.fetch(guildId);

    console.log(`✅ Discord客户端已连接\n`);

    // 构建Tier映射
    const tiers = tierConfigDoc?.value || {};
    const tierRoleToRankMap = {};
    for (const [rank, tierData] of Object.entries(tiers)) {
      if (Array.isArray(tierData.roleIds)) {
        for (const roleId of tierData.roleIds) {
          tierRoleToRankMap[roleId] = rank;
        }
      }
    }

    console.log("🔄 查询玩家等级...\n");

    // 并发查询所有玩家的等级（限制并发数）
    const tierCache = {};
    const batchSize = 5; // 每次并发5个请求

    for (let i = 0; i < allPlayers.length; i += batchSize) {
      const batch = allPlayers.slice(i, i + batchSize);
      const promises = batch.map(async (player) => {
        try {
          const member = await guild.members.fetch(player.discordId);
          const memberRoleIds = member.roles.cache.map((r) => r.id);

          // 找到最高等级
          for (const rank of [...TIER_RANKS].reverse()) {
            if (memberRoleIds.some((id) => tierRoleToRankMap[id] === rank)) {
              tierCache[player.discordId] = rank;
              return;
            }
          }
          // 未找到等级
          tierCache[player.discordId] = null;
        } catch (err) {
          console.error(
            `❌ 获取 ${player.discordId} 失败:`,
            err.message
          );
          tierCache[player.discordId] = null;
        }
      });

      await Promise.all(promises);
      process.stdout.write(
        `  已处理 ${Math.min(i + batchSize, allPlayers.length)}/${allPlayers.length}\r`
      );
    }

    console.log(`\n✅ 所有玩家等级已获取\n`);

    // 保存缓存
    fs.writeFileSync(CACHE_FILE, JSON.stringify(tierCache, null, 2));
    console.log(`💾 缓存已保存到: ${CACHE_FILE}\n`);

    // 统计
    const tierStats = {};
    for (const [_, tier] of Object.entries(tierCache)) {
      const label = tier || "UNKNOWN";
      tierStats[label] = (tierStats[label] || 0) + 1;
    }

    console.log("📊 等级分布:");
    for (const [tier, count] of Object.entries(tierStats).sort()) {
      console.log(`  ${tier}: ${count} 个`);
    }
    console.log();

    await discordClient.destroy();
  } catch (err) {
    console.error("❌ 错误:", err);
    process.exit(1);
  } finally {
    if (client) await client.close();
    process.exit(0);
  }
}

main();
