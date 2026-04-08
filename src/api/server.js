// API 伺服器主程式，負責整合所有路由與錯誤處理
// ------------------------------------------------

const express = require("express");
const path = require("path");
// 匯入服務層組合（包含所有 Service 與 Repository）
const { createServiceContext } = require("../services/createServiceContext");
const { isAppError } = require("../shared/errors");
const { fail } = require("../shared/response");
// 匯入各種路由模組
const { createAdminConsoleRoutes } = require("./routes/adminConsoleRoutes");
const { createAdminPlayerRoutes } = require("./routes/adminPlayerRoutes");
const { createAdminMonsterRoutes } = require("./routes/adminMonsterRoutes");
const { createHealthRoutes } = require("./routes/healthRoutes");
const { createPlayerAppRoutes } = require("./routes/playerAppRoutes");
const cors = require("cors");

// 建立 Express API 伺服器
function createApiServer(discordClient) {
  const app = express();
  
  // 加上 CORS，允許 5173 (Vite 預設 port) 等前端存取
  app.use(cors());
  
  // 建立服務層上下文，供路由使用
  const serviceContext = createServiceContext();

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