# 專案全面分析報告：Equipment Game Platform

> 更新時間：2026-03-31

---

## 📦 專案概覽

這是一個 **Discord-first 遊戲資料平台**，使用 Node.js (CommonJS) + Discord.js + Express 建構。目前處於第一期 MVP 階段，以 JSON 為開發儲存媒介，並預備切換至 MongoDB 正式環境。

---

## 🗂 目錄結構

```
equipmentGAME/
├── src/
│   ├── index.js          ← 主程式進入點
│   ├── config.js         ← 全域環境變數設定
│   ├── bot/              ← Discord Bot 層（入口層）
│   ├── api/              ← Express REST API 層（入口層）
│   ├── services/         ← 商業邏輯層（核心）
│   ├── repositories/     ← Repository 介面定義
│   ├── adapters/         ← 儲存實作（json / mongo）
│   ├── domain/           ← 資料模型工廠函式
│   ├── shared/           ← 共用工具（errors, response, sources, progression）
│   └── web/public/       ← Web 後台靜態檔案
├── data/game.json        ← JSON 儲存檔
├── scripts/              ← 工程檢查腳本
├── PLAN.md               ← 產品與技術規劃
└── README.md             ← 使用說明
```

---

## 🏗 架構層次

| 層次 | 位置 | 說明 |
|---|---|---|
| **入口層** | `src/bot/`, `src/api/` | Discord 指令 / REST API，不可直接存資料庫 |
| **服務層** | `src/services/` | 所有業務規則集中於此 |
| **Repository 介面** | `src/repositories/interfaces/` | 定義資料存取合約 |
| **Adapter 層** | `src/adapters/json/`, `src/adapters/mongo/` | 儲存實作，可熱切換 |
| **領域模型** | `src/domain/` | 純粹資料工廠，無副作用 |
| **共用工具** | `src/shared/` | 錯誤、回應格式、來源常數、升級公式 |

---

## ✅ 已完成功能

### Bot 指令（src/bot/commands.js — 406 行 ⚠️）
- `/連線測試` — bot 延遲偵測
- `/help` — 指令說明
- `/發布玩家面板` — 發布按鈕面板至頻道
- `/發布玩家查詢` — 管理員查詢面板
- `/發布個人房間面板` — 鎖定頻道並發布面板
- `/解鎖個人房間面板` — 還原頻道權限
- `/管理員加金幣`, `/管理員加鑽石`, `/管理員扣金幣`, `/管理員扣鑽石`, `/管理員加經驗`
- Modal 互動：玩家查詢彈出視窗

### 玩家面板按鈕（src/bot/playerPanel.js）
- `建立玩家`、`我的資料`、`我的錢包`、`交易紀錄`、`測試獎勵`、`測試經驗`

### 服務層
- **PlayerService**：`ensurePlayer`, `getProfile`
- **WalletService**：`getWalletByDiscordId`
- **RewardService**：`grantCurrency`（金幣/鑽石，附交易紀錄）
- **ProgressService**：`grantExp`（含升級計算）
- **TransactionService**：`listRecentByDiscordId`
- **AdminService**：`grantCurrencyByAdmin`, `grantExpByAdmin`, `getPlayerSnapshot`, `listRecentAuditLogs`
- **AccessControlService**：管理員/玩家白名單、Discord 角色/用戶同步
- **AdminConsoleService**：頻道佈局管理、發布面板、同步 Discord 頻道/角色清單、權限同步

### API 路由
- `GET /health`
- `GET /admin`（後台頁面）
- `GET /admin/console/bootstrap`
- `GET/PUT /admin/access-control/*`
- `GET /admin/players/:discordId/profile|wallet|transactions`
- `POST /admin/players/:discordId/grant`, `grant-exp`
- `GET /admin/audit-logs`
- `PUT /admin/channel-layout`
- `POST /admin/channel-layout/publish-player-panel|publish-player-query|sync-permissions`
- `GET /admin/console/players`, `/admin/console/players/:discordId`

### 儲存
- **JSON Adapter**：完整實作（playerRepository, walletRepository, progressRepository, transactionRepository, adminActionLogRepository, accessControlRepository, channelLayoutRepository）
- **MongoDB Adapter**：已實作（`createMongoRepositories.js`），可透過 `STORAGE_DRIVER=mongo` 切換

### 其他
- 自動 auto-provision：成員加入或角色更新時自動初始化玩家資料
- 個人房間面板：Bot 啟動時自動發布並鎖定頻道，偵測面板刪除後自動重建
- OneComme 輪詢（`fetchOrderList`）：每 5 秒輪詢留言列表（目前僅 log 輸出）
- 行數限制檢查腳本（320 行警告 / 400 行阻擋）

---

## ⚠️ 發現的問題

### 1. `commands.js` 已超過 400 行限制（406 行）
> 根據工程規範，任何超過 400 行的檔案必須拆分。目前 `commands.js` 已達 406 行，是唯一超標的檔案。

**建議**：將 `管理員加/扣 幣種`、`管理員加經驗`、`發布個人房間面板`、`解鎖個人房間面板` 等邏輯分別拆出為獨立的 handler 模組。

### 2. `commands.js` 第 107-110 行有程式碼殘留 bug
```js
// 發布玩家查詢 的 reply 裡混入了 help 指令的文字
await interaction.reply({
  content: "✅ 玩家查詢面板已發布到目前聊天室。"
    `/管理員扣鑽石\n` +   // ← 這行開頭是反引號（字串無效），會導致語法警告
    `/管理員加經驗\n\n` +
    `玩家操作請直接點聊天室內的玩家面板按鈕。`,
  flags: MessageFlags.Ephemeral
});
```
實際上 `"✅ 玩家查詢面板…"` 後面接的是字串連接，但第二行開頭 **缺少了 `+`**，導致 `/管理員扣鑽石\n` 這段模板字串被當成獨立表達式直接丟棄（silent no-op）。回覆內容只會顯示 `"✅ 玩家查詢面板已發布到目前聊天室。"` 而已，但邏輯上不會報錯。

### 3. `client.js` OneComme 整合殘留
`fetchOrderList()` 輪詢 `localhost:11180/api/orders`，目前僅 `console.log` 輸出新留言，沒有任何業務整合，屬於未完成的整合殘留。若此功能不在目前規劃範圍內，應考慮移除或進一步標示為 TODO。

### 4. `adminConsoleRoutes.js` 中 `/admin` 的 Auth Middleware 順序
```js
router.get("/admin", (_req, res) => { res.sendFile(...) }); // 無需認證 ← 正確
router.use("/admin", authMiddleware); // 後續皆需認證 ← 正確
```
順序是正確的，但值得注意的是 admin 後台**頁面**本身是公開的（僅需知道網址），登入驗證是在 JS 請求 API 時才發生（Bearer Token），這個設計目前可接受，但若後台有敏感資訊需注意。

### 5. `adminPlayerRoutes.js` 使用 `ADMIN_PASSWORD` 而非 `ADMIN_API_KEY`
`.env.example` 中定義了 `ADMIN_PASSWORD`，但 README 中提到的是 `ADMIN_API_KEY` 與 `x-admin-key` header，而程式碼實際使用的是 `Authorization: Bearer <ADMIN_PASSWORD>`。README 說明與實際行為有落差。

### 6. Mongo Adapter 缺少 `channelLayoutRepository` 的沒有 channelLayoutRepository（已有）
查證後 `createMongoRepositories.js` 已實作 `channelLayoutRepository`，但**缺少 `adminActionLogRepository` 的 `listAll`**（JSON 版也一樣），不過目前 `adminConsoleService.listAllPlayers` 使用的是 `playerRepository.listAll`，暫時不影響功能。

---

## 📊 檔案行數現況

| 檔案 | 行數 | 狀態 |
|---|---|---|
| `src/bot/commands.js` | **406** | 🔴 超標（需拆分）|
| `src/api/onesdk.js` | ~1000+ | 待確認（未閱讀）|
| `src/services/admin/accessControlService.js` | 281 | 🟡 接近警告線 |
| `src/services/admin/adminConsoleService.js` | 274 | 🟢 正常 |
| `src/bot/client.js` | 185 | 🟢 正常 |
| `src/bot/playerPanel.js` | 182 | 🟢 正常 |

> `src/api/onesdk.js` 高達 50KB（未閱讀），很可能超過 400 行，需要確認。

---

## 🚀 整體評估

### 優點
- **架構清晰**：嚴格遵守分層，bot/api 不碰資料庫，business logic 全在 services
- **雙儲存支援**：JSON / MongoDB 可無縫切換，Repository 介面完整
- **錯誤處理統一**：`AppError` + 全域 middleware 處理一致
- **中文化設計**：Discord 指令名稱、按鈕全部使用中文，UX 友善
- **自動 provision**：成員加入自動建立玩家資料，設計完善
- **工程治理**：行數限制腳本、PM2 管理腳本齊全

### 待改善
1. `commands.js` 超過 400 行 → 需立即拆分
2. `commands.js` 第 107-110 行的程式碼 bug
3. OneComme 整合殘留需決策（保留 or 清理）
4. README 中 `ADMIN_API_KEY` 說明與實際 `ADMIN_PASSWORD` 不符
5. `onesdk.js` 需確認行數

---

## 🗺 建議下一步

1. **立即**：修正 `commands.js` 第 107-110 行的 bug
2. **短期**：拆分 `commands.js`（可拆出 `adminCurrencyCommands.js`、`adminExpCommands.js`、`personalRoomCommands.js`）
3. **短期**：確認 `onesdk.js` 行數並按需拆分
4. **中期**：釐清 OneComme 整合定位（是否要與 Discord Bot 整合留言互動）
5. **中期**：更新 README 中 API 認證說明（`ADMIN_PASSWORD` 而非 `ADMIN_API_KEY`）
