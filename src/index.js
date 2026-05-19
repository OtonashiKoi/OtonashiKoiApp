require("dotenv").config();

const { installRestartAudit, markBootstrapFailure } = require("./shared/restartAudit");
const { registerCommands } = require("./bot/registerCommands");
const { createBotClient, loginBot } = require("./bot/client");
const { createApiServer } = require("./api/server");
const { serviceContext } = require("./bot/runtimeContext");
const config = require("./config");

installRestartAudit();

async function bootstrap() {
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

  await registerCommands();

  const client = createBotClient();
  await loginBot(client);

  const app = createApiServer(client);
  app.listen(config.api.port, () => {
    console.log(`[API] listening on port ${config.api.port}`);
    console.log(`[Admin] http://localhost:${config.api.port}/admin`);
  });
}

bootstrap().catch((error) => {
  markBootstrapFailure(error);
  console.error("Fatal bootstrap error", error);
  process.exit(1);
});
