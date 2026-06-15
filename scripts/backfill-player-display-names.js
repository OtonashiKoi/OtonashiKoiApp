/**
 * backfill-player-display-names.js
 *
 * 多數玩家的 players.displayName 等於純數字 Discord ID（從沒抓到暱稱）。
 * 這支用 Bot 連 Discord，抓伺服器成員的暱稱/全域名/帳號名，回填到 players.displayName / name，
 * 讓排行榜等處顯示真實 DC 名稱而不是 18 碼 ID。
 *
 * 用法：
 *   node scripts/backfill-player-display-names.js            # dry-run（只統計，不寫入）
 *   node scripts/backfill-player-display-names.js --yes      # 實際寫入
 */
require("dotenv").config();
const { MongoClient } = require("mongodb");
const { Client, GatewayIntentBits } = require("discord.js");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const DB_NAME = process.env.MONGODB_DB_NAME || "equipmentGame";
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const DO_APPLY = process.argv.includes("--yes");

if (!DISCORD_TOKEN || !GUILD_ID) {
  console.error("❌ 缺少 DISCORD_TOKEN / DISCORD_GUILD_ID");
  process.exit(1);
}

// 名稱看起來只是 Discord ID（純數字）或空 → 視為「沒有真實暱稱」
function needsName(displayName, discordId) {
  const dn = String(displayName || "").trim();
  return !dn || dn === String(discordId) || /^\d{15,}$/.test(dn);
}

function resolveMemberName(member) {
  if (!member) return null;
  const nick = member.nickname && member.nickname.trim();
  const global = member.user?.globalName && member.user.globalName.trim();
  const uname = member.user?.username && member.user.username.trim();
  return nick || global || uname || null;
}

async function run() {
  const mongo = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
  try {
    await mongo.connect();
    const db = mongo.db(DB_NAME);
    const players = db.collection("players");

    console.log("⏳ 連接 Discord Bot...");
    await client.login(DISCORD_TOKEN);
    await new Promise((resolve) => client.once("ready", resolve));
    const guild = await client.guilds.fetch(GUILD_ID);
    console.log(`✅ Guild: ${guild.name} (${guild.id})`);
    console.log("⏳ 抓取所有成員...");
    const members = await guild.members.fetch();
    console.log(`✅ 成員數：${members.size}`);

    const all = await players.find({}, { projection: { discordId: 1, displayName: 1 } }).toArray();
    const targets = all.filter((p) => needsName(p.displayName, p.discordId));
    console.log(`玩家總數 ${all.length}，需要回填 ${targets.length}`);

    let resolved = 0, notInGuild = 0;
    const updates = [];
    for (const p of targets) {
      const member = members.get(String(p.discordId));
      const name = resolveMemberName(member);
      if (name) { updates.push({ discordId: p.discordId, name }); resolved++; }
      else notInGuild++;
    }
    console.log(`可解析名稱 ${resolved}，不在伺服器/無法解析 ${notInGuild}`);
    console.log("範例：", updates.slice(0, 10).map((u) => `${u.discordId} → ${u.name}`));

    if (!DO_APPLY) {
      console.log("\n🟡 dry-run（未寫入）。確認無誤後加 --yes 實際回填。");
      return;
    }

    console.log("\n✍️  寫入中...");
    let written = 0;
    for (const u of updates) {
      await players.updateOne(
        { discordId: u.discordId },
        { $set: { displayName: u.name, name: u.name, updatedAt: new Date().toISOString() } }
      );
      written++;
    }
    console.log(`✅ 完成,回填 ${written} 筆。剩 ${notInGuild} 筆不在伺服器(維持原樣,排行榜會以「玩家#末四碼」遮罩)。`);
  } finally {
    await client.destroy().catch(() => {});
    await mongo.close().catch(() => {});
  }
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
