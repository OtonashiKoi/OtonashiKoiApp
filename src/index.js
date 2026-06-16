require("dotenv").config();

// 啟動安全檢查:正式環境若關鍵密鑰仍是弱預設值就中止(防止用公開預設密鑰上線)
require("./config").assertSecureConfig();

async function maybeStartDevMirror() {
  if (process.env.DEV_MIRROR !== "1") return;
  const { startDevMirror } = require("./dev/devMirror");
  const localUri = await startDevMirror({
    sourceUri: process.env.MONGODB_URI,
    dbName: process.env.MONGODB_DB_NAME || "equipmentGame",
    port: Number(process.env.DEV_MIRROR_PORT) || 27018
  });
  // 改寫 env，後面 require 的模組都會用 local URI
  process.env.MONGODB_URI = localUri;
}

async function bootstrap() {
  await maybeStartDevMirror();

  // 注意：以下 require 必須在 maybeStartDevMirror 之後，因為 config 會讀 process.env.MONGODB_URI
  const { installRestartAudit, markBootstrapFailure } = require("./shared/restartAudit");
  const { registerCommands } = require("./bot/registerCommands");
  const { createBotClient, loginBot } = require("./bot/client");
  const { createApiServer } = require("./api/server");
  const { serviceContext } = require("./bot/runtimeContext");
  const config = require("./config");

  installRestartAudit();

  try {
    await serviceContext.effectDefinitionService.syncDefaults();
    try {
      const questService = serviceContext.questService || serviceContext.weeklyQuestService;
      const seedResult = await questService.ensureDefaultSeeds();
      if (seedResult?.createdCount) {
        console.log(`[Quest] seeded default quests: +${seedResult.createdCount}`);
      }
    } catch (e) {
      console.warn("[Quest] seed defaults skipped:", e.message);
    }

    const apiOnly = process.env.API_ONLY === "1";

    if (!apiOnly) {
      await registerCommands();
    } else {
      console.warn("[BOOT] API_ONLY=1 → 跳過 registerCommands（避免覆蓋線上 PC 的 slash command 設定）");
    }

    const client = createBotClient();
    if (!apiOnly) {
      await loginBot(client);
    } else {
      console.warn("[BOOT] API_ONLY=1 → 跳過 loginBot，Discord client 不會連線 gateway（避免搶 token）");
    }

    const app = createApiServer(client);
    app.listen(config.api.port, () => {
      console.log(`[API] listening on port ${config.api.port}${apiOnly ? " (API_ONLY mode)" : ""}`);
      console.log(`[Admin] http://localhost:${config.api.port}/admin`);
    });
  } catch (error) {
    markBootstrapFailure(error);
    throw error;
  }
}

bootstrap().catch((error) => {
  console.error("Fatal bootstrap error", error);
  process.exit(1);
});
