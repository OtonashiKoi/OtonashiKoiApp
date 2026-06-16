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
const { createAdminCombatCalculatorRoutes } = require("./routes/adminCombatCalculatorRoutes");
const { createHealthRoutes } = require("./routes/healthRoutes");
const { createPlayerAppRoutes } = require("./routes/playerAppRoutes");
const { createPlayerCollectionRoutes } = require("./routes/playerCollectionRoutes");
const { createPlayerForgeRoutes } = require("./routes/playerForgeRoutes");
const { createPlayerIdleRoutes } = require("./routes/playerIdleRoutes");
const { createMahjongRoutes } = require("./routes/mahjongRoutes");
const { serviceContext: sharedServiceContext } = require("../bot/runtimeContext");
const config = require("../config");

function createApiServer(discordClient) {
  const app = express();

  const allowedOrigins = config.api.allowedOrigins || [];
  // PUBLIC_BASE_URL 自動加入 allow list（後端自己對外的 URL）
  const publicBaseOrigin = (() => {
    try {
      const u = new URL(config.api?.publicBaseUrl || "");
      return u.origin;
    } catch (_) { return null; }
  })();
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      // 正式環境只信任明確白名單(publicBaseUrl + ALLOWED_ORIGINS);
      // localhost / trycloudflare quick tunnel 僅在非 production 放寬,
      // 避免任意 *.trycloudflare.com(任何人可申請)+ credentials 被當可信來源。
      const isProd = process.env.NODE_ENV === "production";
      if (!isProd) {
        if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) return callback(null, true);
        if (/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(origin)) return callback(null, true);
      }
      if (publicBaseOrigin && origin === publicBaseOrigin) return callback(null, true);
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
  // 上傳圖片長快取（ETag 仍會比對；內容變了 ETag 變、瀏覽器自然抓新圖；7 天內不重打）
  app.use("/uploads", express.static(path.resolve(__dirname, "../web/public/uploads"), {
    maxAge: "7d",
    setHeaders(res) { res.setHeader("Cache-Control", "public, max-age=604800"); }
  }));
  app.use(createHealthRoutes());
  app.use(createAdminConsoleRoutes(serviceContext));
  app.use(createAdminPlayerRoutes(serviceContext));
  app.use(createAdminMonsterRoutes(serviceContext));
  app.use(createAdminMonsterEventRoutes(serviceContext));
  app.use(createAdminWeeklyQuestRoutes(serviceContext));
  app.use(createAdminIdleRoutes(serviceContext));
  app.use(createAdminCreatorAuthRoutes(serviceContext));
  app.use(createAdminCombatCalculatorRoutes(serviceContext));
  app.use(createPlayerAppRoutes(serviceContext, discordClient));
  app.use(createPlayerCollectionRoutes(serviceContext));
  app.use(createPlayerForgeRoutes(serviceContext));
  app.use(createPlayerIdleRoutes(serviceContext));
  app.use(createMahjongRoutes());

  // === Web 前端 SPA 靜態服務 ===
  // equipmentGAME-app 經過 `npm run deploy` 後產出在 src/web/public/app/
  // 提供：
  //   /privacy.html / /terms.html → 原本就有的靜態檔（serve 自 src/web/public/）
  //   /assets/* / /index.html / 等 → web app build 產物
  //   /(其他任何 SPA 路徑) → 回 index.html（HTML5 history 路由）
  const webAppDir = path.resolve(__dirname, "../web/public/app");
  const fs = require("fs");
  if (fs.existsSync(webAppDir)) {
    // 靜態檔：assets / favicon 等
    app.use(express.static(webAppDir, {
      index: false, // 我們自己處理 / 跟 SPA fallback
      setHeaders(res, filePath) {
        // index.html 永遠不快取（部署新版立即生效）
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-store");
        } else if (/\.(js|css|woff2?|png|jpg|jpeg|webp|svg|ico)$/i.test(filePath)) {
          // 帶 hash 的 asset 長快取
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      }
    }));
    // 同時 serve src/web/public/ 根目錄的 privacy.html、terms.html
    app.use(express.static(path.resolve(__dirname, "../web/public"), {
      index: false,
      setHeaders(res) {
        res.setHeader("Cache-Control", "no-store");
      }
    }));
    // SPA fallback：任何不是 api / admin / static / uploads / health / *.html
    // 的 GET 請求，都回 index.html
    const SPA_EXCLUDE = /^\/(api|admin|static|uploads|health)(\/|$)/;
    const indexPath = path.join(webAppDir, "index.html");
    app.use((req, res, next) => {
      if (req.method !== "GET") return next();
      if (SPA_EXCLUDE.test(req.path)) return next();
      if (req.path.includes(".")) return next(); // 有副檔名的，靜態 middleware 已處理 / 404
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        next();
      }
    });
  } else {
    console.warn(`[Web] App build 不存在於 ${webAppDir}，前端 SPA 將無法服務。`);
    console.warn(`[Web]   解決：到 equipmentGAME-app 跑 \`npm run deploy\``);
  }

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
