const express = require("express");
const path = require("path");
const cors = require("cors");
const compression = require("compression");

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
const { createAdminStreamRecordsRoutes } = require("./routes/adminStreamRecordsRoutes");
const { createAdminEnchantRoutes } = require("./routes/adminEnchantRoutes");
const { createAdminWheelRoutes } = require("./routes/adminWheelRoutes");
const { createStreamOverlayRoutes } = require("./routes/streamOverlayRoutes");
const { createHealthRoutes } = require("./routes/healthRoutes");
const { createPlayerAppRoutes } = require("./routes/playerAppRoutes");
const { createPlayerCollectionRoutes } = require("./routes/playerCollectionRoutes");
const { createPlayerForgeRoutes } = require("./routes/playerForgeRoutes");
const { createPlayerCraftingRoutes } = require("./routes/playerCraftingRoutes");
const { createPlayerCharacterRoutes } = require("./routes/playerCharacterRoutes");
const { createPlayerEnchantRoutes } = require("./routes/playerEnchantRoutes");
const { createSoloBossRoutes } = require("./routes/soloBossRoutes");
const { createPlayerIdleRoutes } = require("./routes/playerIdleRoutes");
const { createStoryRoutes } = require("./routes/storyRoutes");
const { createMahjongRoutes } = require("./routes/mahjongRoutes");
const { createEcpayRoutes } = require("./routes/ecpayRoutes");
const { createMerchRoutes } = require("./routes/merchRoutes");
const { createAdminStudioRoutes } = require("./routes/adminStudioRoutes");
const { createAdminSessionRoutes, adminSessionBridge, createAdminAuditMiddleware } = require("./adminSession");
const { serviceContext: sharedServiceContext } = require("../bot/runtimeContext");
const config = require("../config");

function createApiServer(discordClient) {
  const app = express();

  // 正常重啟只需要等待會改資料的 API 完成；SSE／OBS 等長連線應直接重連，
  // 否則 server.close() 會一直等到 PM2 的強制關閉上限。
  let activeWriteRequests = 0;
  app.locals.getActiveWriteRequestCount = () => activeWriteRequests;
  app.use((req, res, next) => {
    const method = String(req.method || "GET").toUpperCase();
    const isWrite = req.path.startsWith("/api") && !["GET", "HEAD", "OPTIONS"].includes(method);
    if (!isWrite) return next();

    activeWriteRequests += 1;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      activeWriteRequests = Math.max(0, activeWriteRequests - 1);
      if (activeWriteRequests === 0) app.emit("write-requests-drained");
    };
    res.once("finish", finish);
    next();
  });

  // 只記錄伺服器本身的慢請求，和瀏覽器/Cloudflare 往返時間分開判讀。
  // 不記 query/body/playerId，避免效能紀錄帶入玩家資料。
  app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on("finish", () => {
      if (!req.path.startsWith("/api")) return;
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      if (elapsedMs >= 500) {
        console.warn(`[API SLOW] ${req.method} ${req.path} ${res.statusCode} ${elapsedMs.toFixed(1)}ms`);
      }
    });
    next();
  });

  // www → 裸網域 301 轉址:避免玩家黏在 www.otonashikoi.org(頁面開得起來但 API 被 CORS 擋)。
  // www 與裸網域都經 cloudflared 進到同一個 Express,在最前面攔 Host=www.* 的請求轉回裸網域 https。
  // 只命中 www.* 前綴,不影響裸網域 / staging(test.) / localhost。
  app.use((req, res, next) => {
    const host = String(req.headers.host || "").toLowerCase();
    if (host.startsWith("www.")) {
      return res.redirect(301, `https://${host.slice(4)}${req.originalUrl}`);
    }
    next();
  });

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

  // 全站 gzip 壓縮：手機端輪詢的 JSON 流量大減（省電、省流量）。
  // SSE(text/event-stream) 必須排除：compression 會緩衝輸出，壓縮會讓事件流卡住不即時送達。
  app.use(compression({
    filter: (req, res) => {
      const contentType = String(res.getHeader("Content-Type") || "");
      if (contentType.includes("text/event-stream")) return false;
      if (/stream$/.test(req.path)) return false; // 保險：SSE 端點路徑都以 stream 結尾
      return compression.filter(req, res);
    }
  }));

  // 全站速率限制(per-IP 固定視窗):擋腳本高頻灌爆 API/DB。
  // SSE 長連線端點(/...stream)略過(單一長連線、本身另有連線數上限)。
  const { createRateLimiter } = require("./netGuards");
  const apiRateLimiter = createRateLimiter({ windowMs: 10_000, max: 300 });
  app.use("/api", (req, res, next) => {
    if (/stream$/.test(req.path)) return next(); // SSE 長連線端點(/...stream)略過
    if (/ecpay\/live-notify$/.test(req.path)) return next(); // 綠界金流回呼不可被限流(需回 1|OK)
    return apiRateLimiter(req, res, next);
  });

  app.use(express.json({ limit: "8mb" })); // 劇情章節(數百節點+演出+草稿)存檔 JSON 會超過預設 100kb

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
  app.use(createAdminSessionRoutes());
  app.use(createAdminStudioRoutes());
  app.use("/admin", adminSessionBridge);
  app.use("/admin", createAdminAuditMiddleware(serviceContext));
  app.use(createAdminConsoleRoutes(serviceContext));
  app.use(createAdminPlayerRoutes(serviceContext));
  app.use(createAdminMonsterRoutes(serviceContext));
  app.use(createAdminMonsterEventRoutes(serviceContext));
  app.use(createAdminWeeklyQuestRoutes(serviceContext));
  app.use(createAdminIdleRoutes(serviceContext));
  app.use(createAdminCreatorAuthRoutes(serviceContext));
  app.use(createAdminCombatCalculatorRoutes(serviceContext));
  app.use(createAdminStreamRecordsRoutes(serviceContext, discordClient));
  app.use(createAdminEnchantRoutes());
  app.use(createAdminWheelRoutes());
  app.use(createStreamOverlayRoutes());
  app.use(require("./routes/adminLiveRoutes").createAdminLiveRoutes(serviceContext));
  app.use(createPlayerAppRoutes(serviceContext, discordClient));
  app.use(createPlayerCharacterRoutes(serviceContext));
  app.use(createPlayerCollectionRoutes(serviceContext));
  app.use(createPlayerForgeRoutes(serviceContext));
  app.use(createPlayerCraftingRoutes(serviceContext));
  app.use(createPlayerEnchantRoutes(serviceContext));
  app.use(createSoloBossRoutes(serviceContext));
  app.use(createPlayerIdleRoutes(serviceContext));
  app.use(createStoryRoutes(serviceContext, discordClient));
  app.use(createMahjongRoutes());
  app.use(createEcpayRoutes(serviceContext));
  app.use(createMerchRoutes(serviceContext));

  // UI 改版測試入口：沿用正式 game.html 的所有玩家流程與 API，
  // 僅在 /test 注入獨立視覺樣式，不影響既有 /game.html 或 SPA 正式版。
  const fs = require("fs");
  const testGamePath = path.resolve(__dirname, "../web/public/game.html");
  app.get("/test", (_req, res, next) => {
    try {
      const gameHtml = fs.readFileSync(testGamePath, "utf8");
      const themedHtml = gameHtml
        .replace("</head>", '  <link rel="stylesheet" href="/static/test-ui.css">\\n</head>')
        .replace("<body>", '<body class="test-mode">');
      res.setHeader("Cache-Control", "no-store");
      res.type("html").send(themedHtml);
    } catch (error) {
      next(error);
    }
  });

  // === Web 前端 SPA 靜態服務 ===
  // equipmentGAME-app 經過 `npm run deploy` 後產出在 src/web/public/app/
  // 提供：
  //   /privacy.html / /terms.html → 原本就有的靜態檔（serve 自 src/web/public/）
  //   /assets/* / /index.html / 等 → web app build 產物
  //   /(其他任何 SPA 路徑) → 回 index.html（HTML5 history 路由）
  const webAppDir = path.resolve(__dirname, "../web/public/app");
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
        // index.html 永不快取：確保開根網址/SPA 路由時，永遠抓到最新 index →
        // 指向最新 hash 過的 JS/CSS（否則瀏覽器/Cloudflare 會卡在舊版，選單/功能停在舊狀態）
        res.setHeader("Cache-Control", "no-store, must-revalidate");
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
