"use strict";
/**
 * 建立 龍族之領 Discord 頻道 + 寫入 channelLayout binding
 *
 * 流程：
 *  1. 用 bot token 登入（獨立 client，不影響運行中的 bot）
 *  2. 找 ancient_city_deep 頻道所在的 category（同分類）
 *  3. 在同 category 建立 #🐉-龍族之領
 *  4. 寫入 channelLayout：featureKey=monster_zone_dragon_realm
 *
 * 完成後請：
 *   1. npm run pm2:restart        （讓 bot 載入新版 zones.js）
 *   2. node scripts/republish-all-panels.js  （或後台手動發面板）
 */
require("dotenv").config();
const { Client, GatewayIntentBits, ChannelType } = require("discord.js");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const config = require("../src/config");

const GUILD_ID = config.discord.guildId;
const NEW_FEATURE_KEY = "monster_zone_dragon_realm";
const CHANNEL_NAME = "【戰鬥爽】地圖-龍族之領";
const CHANNEL_TOPIC = "龍族之領（Lv.40-50）— 古龍盤踞之地，秘銀甲冑由此而出";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(config.discord.token);
  console.log(`[Discord] logged in as ${client.user.tag}`);

  const guild = await client.guilds.fetch(GUILD_ID);

  // 從現有 binding 找 deep 頻道（拿 parentId）
  const db = await getMongoDb();
  const layout = await db.collection("channelLayout").findOne({ _id: "default" });
  const value = layout?.value || {};
  value.discord = value.discord || {};
  const bindings = Array.isArray(value.discord.bindings) ? [...value.discord.bindings] : [];

  const deepBinding = bindings.find((b) => b.featureKey === "monster_zone_ancient_city_deep" && b.channelId);
  if (!deepBinding) {
    console.error("❌ 找不到 monster_zone_ancient_city_deep 綁定，無法判斷要放哪個 category");
    await client.destroy();
    process.exit(1);
  }
  const deepCh = await guild.channels.fetch(deepBinding.channelId);
  console.log(`參考頻道：#${deepCh.name} (parent ${deepCh.parentId})`);

  // 檢查是否已存在
  let dragonCh = guild.channels.cache.find((c) => c.parentId === deepCh.parentId && c.name === CHANNEL_NAME);

  if (!dragonCh) {
    if (dryRun) {
      console.log(`[DRY-RUN] 會建立 #${CHANNEL_NAME} 在 parent ${deepCh.parentId}`);
    } else {
      dragonCh = await guild.channels.create({
        name: CHANNEL_NAME,
        type: ChannelType.GuildText,
        parent: deepCh.parentId || undefined,
        topic: CHANNEL_TOPIC,
        reason: "新增龍族之領（Lv.40-50）",
      });
      console.log(`✅ 新建頻道 #${dragonCh.name} → ${dragonCh.id}`);
    }
  } else {
    console.log(`↩️ 已有 #${dragonCh.name} → ${dragonCh.id}`);
  }

  // 寫入 binding
  const channelId = dragonCh?.id || (dryRun ? "(dry-run-pending)" : null);
  if (channelId) {
    const idx = bindings.findIndex((b) => b.featureKey === NEW_FEATURE_KEY);
    const entry = {
      featureKey: NEW_FEATURE_KEY,
      channelId,
      enabled: true,
      panelMessageId: "",
      note: "",
      visibleTo: { player: true, admin: true },
    };
    if (idx >= 0) {
      bindings[idx] = { ...bindings[idx], ...entry };
      console.log(`UPDATE binding ${NEW_FEATURE_KEY} → ${channelId}`);
    } else {
      bindings.push(entry);
      console.log(`ADD    binding ${NEW_FEATURE_KEY} → ${channelId}`);
    }

    if (!dryRun) {
      value.discord.bindings = bindings;
      await db.collection("channelLayout").updateOne(
        { _id: "default" },
        { $set: { value, updatedAt: new Date().toISOString() } }
      );
      console.log("✅ channelLayout 已更新");
    }
  }

  await client.destroy();
  console.log("\n👉 接下來請執行：");
  console.log("   1. npm run pm2:restart");
  console.log("   2. node scripts/republish-all-panels.js");
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
