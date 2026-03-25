require("dotenv").config();

const http = require("http");
const config = require("./config");
const { registerCommands } = require("./bot/registerCommands");
const { createBotClient, loginBot } = require("./bot/client");
const { createWebServer } = require("./web/server");

async function bootstrap() {
  await registerCommands();

  const client = createBotClient();
  await loginBot(client);

  const app = createWebServer();
  const server = http.createServer(app);

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.warn(`[Web] port ${config.port} already in use, skip web server startup.`);
      return;
    }
    console.error("[Web] server error", error);
  });

  server.listen(config.port, () => {
    console.log(`[Web] listening on port ${config.port}`);
  });
}

bootstrap().catch((error) => {
  console.error("Fatal bootstrap error", error);
  process.exit(1);
});
