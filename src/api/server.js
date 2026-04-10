// API 伺服器主程式，負責整合所有路由與錯誤處理
// ------------------------------------------------

const express = require("express");
const path = require("path");
// 匯入服務層組合（包含所有 Service 與 Repository）
const { isAppError } = require("../shared/errors");
const { fail } = require("../shared/response");
// 匯入各種路由模組
const { createAdminConsoleRoutes } = require("./routes/adminConsoleRoutes");
const { createAdminPlayerRoutes } = require("./routes/adminPlayerRoutes");
const { createAdminMonsterRoutes } = require("./routes/adminMonsterRoutes");
const { createAdminWeeklyQuestRoutes } = require("./routes/adminWeeklyQuestRoutes");
const { createHealthRoutes } = require("./routes/healthRoutes");
const { createPlayerAppRoutes } = require("./routes/playerAppRoutes");
const { serviceContext: sharedServiceContext } = require("../bot/runtimeContext");
const cors = require("cors");
const config = require("../config");

// 建立 Express API 伺服器
function createApiServer(discordClient) {
  const app = express();

  // CORS：localhost 全放行（開發用），正式環境只允許 ALLOWED_ORIGINS
  const allowedOrigins = config.api.allowedOrigins || [];
  app.use(cors({
    origin: (origin, callback) => {
      // 無 origin（curl、Postman）或 localhost 任意 port 全放行
      if (!origin) return callback(null, true);
      if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true
  }));
  
  // 使用共用的 serviceContext（與 bot runtimeContext 同一個實例）
  const serviceContext = sharedServiceContext;

  // 解析 JSON 請求
  app.use(express.json());
  // 提供靜態檔案（如前端網頁）
  app.use("/static", express.static(path.resolve(__dirname, "../web/public")));
  // 玩家上傳圖片（道具圖片等）
  app.use("/uploads", express.static(path.resolve(__dirname, "../web/public/uploads")));
  // 怪物圖片
  app.use("/uploads/monsters", express.static(path.resolve(__dirname, "../web/public/uploads/monsters")));
  // 健康檢查路由
  app.use(createHealthRoutes());
  // 管理後台路由
  app.use(createAdminConsoleRoutes(serviceContext));
  // 玩家管理路由
  app.use(createAdminPlayerRoutes(serviceContext));
  // 怪物管理路由
  app.use(createAdminMonsterRoutes(serviceContext));
  // 每週任務路由
  app.use(createAdminWeeklyQuestRoutes(serviceContext));
  // 玩家前端 WebApp 路由
  app.use(createPlayerAppRoutes(serviceContext, discordClient));

  // 全域錯誤處理（捕捉所有未處理例外）
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

// 匯出 API 伺服器建構函式
module.exports = {
  createApiServer
};