const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const { getBotClient } = require("../src/bot/runtimeContext");

async function main() {
  const botClient = getBotClient();
  
  if (!botClient) {
    console.error("❌ Bot 未初始化");
    return;
  }

  const channelId = "1450059054071418910"; // park_announcement
  const channel = botClient.channels.cache.get(channelId);

  if (!channel) {
    console.error("❌ 找不到頻道");
    return;
  }

  const announcement = `⚠️ **重大錯誤修正公告**

親愛的玩家：
我們發現中級區及高級區經濟數值存在重大錯誤。

🔧 **已完成修正：**
- 中級區：進場費 200G、獲得金幣 2200G（淨利 2000G）
- 高級區：進場費 350G、獲得金幣 2350G（淨利 2000G）

受影響玩家已發送補償道具。
感謝耐心與配合！`;

  try {
    await channel.send(announcement);
    console.log("✅ 公告已發送");
  } catch (error) {
    console.error("❌ 發送失敗:", error.message);
  }
}

main();
