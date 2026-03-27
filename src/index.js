require("dotenv").config();

const { registerCommands } = require("./bot/registerCommands");
const { createBotClient, loginBot } = require("./bot/client");
const { createApiServer } = require("./api/server");
const config = require("./config");

async function bootstrap() {
  await registerCommands();

  const client = createBotClient();
  await loginBot(client);

  const app = createApiServer();
  app.listen(config.api.port, () => {
    console.log(`[API] listening on port ${config.api.port}`);
  });
}

bootstrap().catch((error) => {
  console.error("Fatal bootstrap error", error);
  process.exit(1);
});
