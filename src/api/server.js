const express = require("express");
const path = require("path");
const cors = require("cors");

const { isAppError } = require("../shared/errors");
const { fail } = require("../shared/response");
const { createAdminConsoleRoutes } = require("./routes/adminConsoleRoutes");
const { createAdminPlayerRoutes } = require("./routes/adminPlayerRoutes");
const { createAdminMonsterRoutes } = require("./routes/adminMonsterRoutes");
const { createAdminMonsterEventRoutes } = require("./routes/adminMonsterEventRoutes");
const { createAdminWeeklyQuestRoutes } = require("./routes/adminWeeklyQuestRoutes");
const { createHealthRoutes } = require("./routes/healthRoutes");
const { createPlayerAppRoutes } = require("./routes/playerAppRoutes");
const { serviceContext: sharedServiceContext } = require("../bot/runtimeContext");
const config = require("../config");

function createApiServer(discordClient) {
  const app = express();

  const allowedOrigins = config.api.allowedOrigins || [];
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true
  }));

  const serviceContext = sharedServiceContext;

  app.use(express.json());
  app.use("/static", express.static(path.resolve(__dirname, "../web/public")));
  app.use("/uploads", express.static(path.resolve(__dirname, "../web/public/uploads")));

  app.use(createHealthRoutes());
  app.use(createAdminConsoleRoutes(serviceContext));
  app.use(createAdminPlayerRoutes(serviceContext));
  app.use(createAdminMonsterRoutes(serviceContext));
  app.use(createAdminMonsterEventRoutes(serviceContext));
  app.use(createAdminWeeklyQuestRoutes(serviceContext));
  app.use(createPlayerAppRoutes(serviceContext, discordClient));

  app.use((error, _req, res, _next) => {
    console.error("[API] request error", error);
    if (isAppError(error)) {
      res.status(error.status).json(fail(error.code, error.message));
      return;
    }
    res.status(500).json(fail("INTERNAL_ERROR", "Unexpected server error."));
  });

  return app;
}

module.exports = {
  createApiServer
};

