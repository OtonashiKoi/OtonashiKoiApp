#!/usr/bin/env node
/**
 * 快速查询Discord角色并分配tier+钻石
 */

require("dotenv").config();
const { MongoClient } = require("mongodb");
const https = require("https");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "equipment_game";
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

const TIER_RANKS = ["E", "D", "C", "B", "A", "S", "SS"];

function fetchDiscordMember(userId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "discord.com",
      path: `/api/v10/guilds/${GUILD_ID}/members/${userId}`,
      method: "GET",
      headers: {
        Authorization: `Bot ${DISCORD_TOKEN}`,
        "User-Agent": "EquipmentGame/1.0",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        } else {
          resolve(null); // 用户不存在或无法访问
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(5000);
    req.end();
  });
}

async function getPlayerTier(discordId, roleToTierMap) {
  try {
    const member = await fetchDiscordMember(discordId);
    if (!member || !member.roles) return null;

    // 从高到低找等级
    for (const tier of [...TIER_RANKS].reverse()) {
      if (member.roles.some((roleId) => roleToTierMap[roleId] === tier)) {
        return tier;
      }
    }
    return null;
  } catch (err) {
    return null;
  }
}

function getDiamondAmount(tier) {
  if (tier === "A" || tier === "S" || tier === "SS") return 10;
  if (tier === "B") return 3;
  if (tier === "C") return 1;
  return 0; // UNKNOWN
}

async function main() {
  let client;
  try {
    console.log("🔗 连接到 MongoDB...");
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db(MONGODB_DB_NAME);

    const players = db.collection("players");
    const wallets = db.collection("wallets");
    const tierConfig = await db.collection("playerTiers").findOne({ _id: "default" });

    // 构建roleId到tier的映射
    console.log("🎖️ 构建Tier映射...");
    const roleToTierMap = {};
    const tierValue = tierConfig?.value || {};

    for (const [tier, tierData] of Object.entries(tierValue)) {
      if (Array.isArray(tierData.roleIds)) {
        for (const roleId of tierData.roleIds) {
          roleToTierMap[roleId] = tier;
        }
      }
    }
    console.log(`✅ ${Object.keys(roleToTierMap).length} 个角色ID已映射\n`);

    // 获取所有玩家
    console.log("📋 获取玩家列表...");
    const allPlayers = await players.find({}).toArray();
    console.log(`✅ 找到 ${allPlayers.length} 个玩家\n`);

    // 并发查询tier（限制速率）
    console.log("🔄 查询Discord角色...\n");
    const tierMap = {};
    const tierStats = {};
    const batchSize = 3;
    let processed = 0;

    for (let i = 0; i < allPlayers.length; i += batchSize) {
      const batch = allPlayers.slice(i, i + batchSize);
      const promises = batch.map(async (player) => {
        const tier = await getPlayerTier(player.discordId, roleToTierMap);
        tierMap[player.discordId] = tier;
        tierStats[tier || "UNKNOWN"] = (tierStats[tier || "UNKNOWN"] || 0) + 1;
      });

      await Promise.all(promises);
      processed += batch.length;
      process.stdout.write(`  已查询 ${processed}/${allPlayers.length}\r`);

      // 简单速率限制
      await new Promise((r) => setTimeout(r, 500));
    }

    console.log(`\n✅ 所有玩家tier已获取\n`);

    // 显示分布
    console.log("📊 Tier分布:");
    for (const [tier, count] of Object.entries(tierStats).sort()) {
      console.log(`  ${tier}: ${count} 个`);
    }
    console.log();

    // 更新钻石
    console.log("💎 更新钻石...\n");
    let updated = 0;

    for (const player of allPlayers) {
      try {
        const tier = tierMap[player.discordId];
        const diamonds = getDiamondAmount(tier);

        await wallets.updateOne(
          { playerId: player.discordId },
          { $set: { diamond: diamonds, updatedAt: new Date().toISOString() } },
          { upsert: false }
        );

        updated++;
        if (updated % 50 === 0) {
          process.stdout.write(`  已更新 ${updated}/${allPlayers.length}\r`);
        }
      } catch (err) {
        console.error(`❌ 更新 ${player.displayName} 失败:`, err.message);
      }
    }

    console.log(`\n✅ 完成！已更新 ${updated}/${allPlayers.length} 个玩家的钻石\n`);

    // 统计钻石分配
    console.log("💰 钻石分配统计:");
    const diamondStats = {};
    for (const [discordId, tier] of Object.entries(tierMap)) {
      const diamonds = getDiamondAmount(tier);
      diamondStats[diamonds] = (diamondStats[diamonds] || 0) + 1;
    }
    for (const [diamonds, count] of Object.entries(diamondStats).sort()) {
      console.log(`  ${diamonds} 颗: ${count} 个玩家`);
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
