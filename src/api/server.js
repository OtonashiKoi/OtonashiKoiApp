const express = require("express");
const path = require("path");
const cors = require("cors");

const { isAppError } = require("../shared/errors");
const { fail } = require("../shared/response");
const { setApiContractHeaders } = require("../shared/apiContract");
const { runWithCache } = require("../adapters/mongo/requestCache");
const { createAdminConsoleRoutes } = require("./routes/adminConsoleRoutes");
const { createAdminPlayerRoutes } = require("./routes/adminPlayerRoutes");
const { createAdminMonsterRoutes } = require("./routes/adminMonsterRoutes");
const { createAdminMonsterEventRoutes } = require("./routes/adminMonsterEventRoutes");
const { createAdminWeeklyQuestRoutes } = require("./routes/adminWeeklyQuestRoutes");
const { createAdminIdleRoutes } = require("./routes/adminIdleRoutes");
const { createAdminCreatorAuthRoutes } = require("./routes/adminCreatorAuthRoutes");
const { createHealthRoutes } = require("./routes/healthRoutes");
const { createPlayerAppRoutes } = require("./routes/playerAppRoutes");
const { createPlayerIdleRoutes } = require("./routes/playerIdleRoutes");
const { createMahjongRoutes } = require("./routes/mahjongRoutes");
const { serviceContext: sharedServiceContext } = require("../bot/runtimeContext");
const config = require("../config");

function createApiServer(discordClient) {
  const app = express();

  const allowedOrigins = config.api.allowedOrigins || [];
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) return callback(null, true);
      // Cloudflare Tunnel quick tunnels — 開發環境使用，URL 會隨重啟改變
      if (/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(origin)) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true
  }));

  const serviceContext = sharedServiceContext;

  app.use(express.json());

  // Freeze API contract via response headers without changing existing payload shapes.
  app.use((_req, res, next) => {
    setApiContractHeaders(res);
    next();
  });

  // 每個 API 請求建立獨立的記憶體快取 context
  // 同一請求內對同一 playerId 的重複 DB 讀取直接從記憶體回傳
  app.use((_req, _res, next) => runWithCache(next));
  app.use("/static", express.static(path.resolve(__dirname, "../web/public"), {
    etag: false,
    lastModified: false,
    setHeaders(res) {
      const contentType = String(res.getHeader("Content-Type") || "");
      if (
        contentType &&
        !/charset=/i.test(contentType) &&
        (contentType.startsWith("text/") ||
          contentType.includes("javascript") ||
          contentType.includes("json") ||
          contentType.includes("xml"))
      ) {
        res.setHeader("Content-Type", `${contentType}; charset=utf-8`);
      }
      res.setHeader("Cache-Control", "no-store");
    }
  }));
  app.use("/uploads", express.static(path.resolve(__dirname, "../web/public/uploads")));
  app.use(createHealthRoutes());
  app.use(createAdminConsoleRoutes(serviceContext));
  app.use(createAdminPlayerRoutes(serviceContext));
  app.use(createAdminMonsterRoutes(serviceContext));
  app.use(createAdminMonsterEventRoutes(serviceContext));
  app.use(createAdminWeeklyQuestRoutes(serviceContext));
  app.use(createAdminIdleRoutes(serviceContext));
  app.use(createAdminCreatorAuthRoutes(serviceContext));
  app.use(createPlayerAppRoutes(serviceContext, discordClient));
  app.use(createPlayerIdleRoutes(serviceContext));
  app.use(createMahjongRoutes());

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

