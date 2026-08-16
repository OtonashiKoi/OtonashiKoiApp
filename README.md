# equipmentGAME

Discord Bot、玩家 Web App、Express API 與 Web 管理後台共用同一套遊戲服務的線上 RPG 專案。目前不是骨架或 Phase 1；正式執行層為 **MongoDB-only**，JSON 檔只可能是匯出、備份、種子或歷史資料，不是可切換的 runtime adapter。

文件請從 [docs/README.md](docs/README.md) 開始。功能現況看 [PROJECT_FEATURES.md](PROJECT_FEATURES.md)，程式位置看 [docs/SYSTEMS.md](docs/SYSTEMS.md)，MongoDB 資料快照看 [docs/CURRENT_GAME_STATUS.md](docs/CURRENT_GAME_STATUS.md)。

## 目前關鍵狀態

- 爬塔程式仍保留，但目前暫停開放；Discord 互動與 `/api/tower/*` 都有伺服器端守門。
- 職業共有 11 個一轉、13 條二轉分支；每個一轉至少 1 條可用，另有 2 條分支鎖定（劍鬼、盜靈）。
- 世界王服務目前接有大史王、古龍王、地獄狼牙王、活動島島龜王。
- YouTube 待機室出現時會對同一 broadcastId 發 1 次直播預告；正式開播確認後可再發 1 次開台通知。
- 觀看人數加成、斗內、SC 累積與會員活動由 MongoDB `serverEventConfig` 控制，不可只看程式預設值判斷是否啟用。
- 聖人任務只累計實際非吸血治療；鮮血任務只累計實際吸血；滿血溢出不計。

## 執行架構

- 啟動入口：`src/index.js`
- Discord：`src/bot/`
- Express 與路由：`src/api/server.js`、`src/api/routes/`
- 遊戲服務：`src/services/`
- 共用戰鬥與規則：`src/shared/`
- MongoDB repositories：`src/adapters/mongo/`、`src/repositories/createRepositories.js`
- 管理後台與靜態頁：`src/web/public/`
- 玩家 SPA 部署產物：`src/web/public/app/`（生成內容，不在這裡手改）
- 維運、資料種子與驗證：`scripts/`

### 玩家 SPA 原始碼與部署產物

玩家實際操作的 React／TypeScript 原始碼位於獨立 repository：[OtonashiKoi/equipmentGAME-app](https://github.com/OtonashiKoi/equipmentGAME-app)，本機工作區為 `~/Documents/equipmentGAME-app`。

本 repository 的 `src/web/public/app/` 只是該 SPA 經 TypeScript／Vite 編譯後的部署成品。修改玩家介面時必須先改 `equipmentGAME-app`、完成測試與 build，再透過其 `npm run deploy` 複製成品；不要直接編輯 hash 命名的 bundle。

因此一個完整發布會有兩個可追溯來源：SPA repository 的原始碼 commit，以及本 repository 收錄部署成品的 commit。正式部署不得從未提交或無法辨識來源的 SPA 工作樹產生。

## 安裝與啟動

需求：Node.js、可連線的 MongoDB、Discord Bot／OAuth 必要憑證。

```bash
npm install
cp .env.example .env
npm run discord:register
npm start
```

主要必要設定依環境而異，至少確認：

- `MONGODB_URI`、`MONGODB_DB_NAME`
- `DISCORD_TOKEN`、`DISCORD_CLIENT_ID`、`DISCORD_GUILD_ID`
- `JWT_SECRET`、`ADMIN_PASSWORD`
- `API_PORT`、`PUBLIC_BASE_URL`、`ALLOWED_ORIGINS`

正式環境若 `JWT_SECRET` 或 `ADMIN_PASSWORD` 未設定／仍為弱預設值，啟動會直接失敗。其餘 Discord 頻道、OAuth、直播與金流設定請依 [部署指南](docs/DEPLOYMENT_GUIDE.md) 與 [OAuth 指南](docs/OAUTH_SETUP_GUIDE.md) 檢查。

## 常用指令

```bash
npm run check                 # 語法、行數與文件一致性
npm run check:sensitive       # 阻止備份、BSON、會員／玩家資料進入 Git
npm run test:ci               # 不依賴正式 MongoDB 的 GitHub Actions 品質門檻
npm run check:docs            # 文件硬事實防漂移
npm run test:features         # 核心功能與資料檢查
npm run test:systems          # 系統驗證
npm run test:golden           # 戰鬥黃金快照
npm run test:anchor-quest-metrics
npm run test:stream-notifications
npm run status:update         # 由程式碼 + MongoDB 重建現況快照
```

PM2：

```bash
npm run pm2:start
npm run pm2:restart
npm run pm2:status
npm run pm2:logs
npm run pm2:stop
```

## 主要入口

- 玩家網站：`/`
- 管理後台：`/admin`
- 健康檢查：`/health`
- UI 測試入口：`/test`
- 玩家 API：`/api/*`
- 管理 API：`/admin/*`
- 靜態資源：`/static/*`、`/uploads/*`

API 不只早期文件列出的幾條；實際掛載由 `src/api/server.js` 與 `src/api/routes/*.js` 決定。穩定回應格式與相容範圍看 [API Contract v1](docs/API_CONTRACT_V1.md)。

## Discord 指令

目前註冊：`/連線測試`、`/help`、`/發布玩家面板`、`/發布個人房間面板`、`/發布玩家查詢`、管理員加扣金幣／鑽石、管理員加經驗、`/發布拍賣場面板`、`/發布pk擂台`、`/發布爬塔面板`。

`/發布爬塔面板` 仍存在是為了保留管理與未來復用，但玩家點擊時會收到爬塔暫停提示，不能繞過總開關開始戰鬥。

## 文件同步規則

1. 程式與目前 MongoDB 是執行事實。
2. 功能改動要同步 `PROJECT_FEATURES.md` 或 `docs/SYSTEMS.md`；戰鬥規則同步 `COMBAT_FORMULA.md`。
3. 資料／開關變動後跑 `npm run status:update`。
4. 提案、handoff、changelog、benchmark 與日期報告不能當成現況文件。
5. 提交前跑 `npm run check`；`check:docs` 會攔截 MongoDB-only、爬塔與二轉數量等常見漂移。
