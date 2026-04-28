const fs = require("fs");
const path = require("path");
const { REST, Routes } = require("discord.js");

async function main() {
  // 讀取 .env 文件
  const envPath = path.resolve(__dirname, "../.env");
  const envContent = fs.readFileSync(envPath, "utf-8");
  const tokenMatch = envContent.match(/DISCORD_TOKEN=(.+)/);
  
  if (!tokenMatch || !tokenMatch[1]) {
    console.error("❌ DISCORD_TOKEN 未設定");
    return;
  }

  const token = tokenMatch[1].trim();
  const channelId = "1450059054071418910"; // park_announcement

  const rest = new REST().setToken(token);

  const announcement = `⚠️ **重大錯誤修正公告**

親愛的玩家：
我們發現中級區及高級區經濟數值存在重大錯誤。

🔧 **已完成修正：**
- 中級區：進場費 200G、獲得金幣 2200G（淨利 2000G）
- 高級區：進場費 350G、獲得金幣 2350G（淨利 2000G）

受影響玩家已發送補償道具。
感謝耐心與配合！`;

  try {
    await rest.post(Routes.channelMessages(channelId), {
      body: { content: announcement }
    });
    console.log("✅ 公告已發送到 #park_announcement");
  } catch (error) {
    console.error("❌ 發送失敗:", error.message);
  }
}

main();
