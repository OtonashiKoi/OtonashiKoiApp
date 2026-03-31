// 主程式進入點，負責初始化 Discord Bot 與 API 伺服器
// ------------------------------------------------------

// 載入 .env 設定檔，讓 process.env 取得環境變數
require("dotenv").config();

// 匯入註冊 Discord 指令的模組
const { registerCommands } = require("./bot/registerCommands");
// 匯入建立與登入 Discord Bot 的相關函式
const { createBotClient, loginBot } = require("./bot/client");
// 匯入建立 API 伺服器的函式
const { createApiServer } = require("./api/server");
// 匯入全域設定
const config = require("./config");

// 啟動流程：
// 1. 註冊 Discord 指令
// 2. 啟動 Discord Bot 並登入
// 3. 啟動 API 伺服器
async function bootstrap() {
  // 註冊 Discord 指令（Slash Commands）
  await registerCommands();

  // 建立 Discord Bot Client 並登入
  const client = createBotClient();
  await loginBot(client);

  // 啟動 Express API 伺服器，監聽指定 port
  const app = createApiServer();
  app.listen(config.api.port, () => {
    console.log(`[API] listening on port ${config.api.port}`);
  });
}

// 啟動主流程，若發生錯誤則輸出並結束程式
bootstrap().catch((error) => {
  console.error("Fatal bootstrap error", error);
  process.exit(1);
});
