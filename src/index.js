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

    // 輕量記憶體監控:每 5 分鐘印 RSS / heap,方便觀察是否有洩漏(配合 PM2 max_memory_restart 防 OOM)
    const _memTimer = setInterval(() => {
      try {
        const m = process.memoryUsage();
        const mb = (n) => Math.round(n / 1048576);
        console.log(`[Mem] rss=${mb(m.rss)}MB heapUsed=${mb(m.heapUsed)}/${mb(m.heapTotal)}MB ext=${mb(m.external)}MB`);
      } catch (_) { /* noop */ }
    }, 5 * 60 * 1000);
    _memTimer.unref?.();

    // 全服 Buff 快取初始化（直播連動事件）：載入生效中的 buff 到記憶體
    try {
      await require("./services/stream/globalBuffService").init();
      await require("./services/stream/streamEventConfig").syncRuntimeConfig(); // 注入短期 buff 上限
      // 會員里程碑檢查：每 3 分鐘看會員數有無創新高 → 短期慶祝 / 賽季永久里程碑
      const memberEvents = require("./services/stream/memberEventsService");
      memberEvents.check(serviceContext).catch(() => {});
      const _memberTimer = setInterval(() => { memberEvents.check(serviceContext).catch(() => {}); }, 3 * 60 * 1000);
      _memberTimer.unref?.();
    } catch (e) {
      console.warn("[GlobalBuff] init 失敗（不影響啟動）：", e?.message || e);
    }

    // 附魔設定快取初始化（發裝時骰附魔用）
    try {
      await require("./services/enchant/enchantService").init();
    } catch (e) {
      console.warn("[Enchant] init 失敗（不影響啟動）：", e?.message || e);
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
