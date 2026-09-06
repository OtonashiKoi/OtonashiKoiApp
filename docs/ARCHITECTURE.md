# equipmentGAME 現行架構

> 狀態：現行架構文件。最後以程式碼核對：2026-08-10。
>
> 功能清單看 [PROJECT_FEATURES.md](../PROJECT_FEATURES.md)，檔案定位看 [SYSTEMS.md](SYSTEMS.md)，DB 內容看 [CURRENT_GAME_STATUS.md](CURRENT_GAME_STATUS.md)。

## 系統形態

同一個 Node.js process 預設同時承載：

1. Discord.js Bot：斜線指令、按鈕、選單、頻道面板、事件監聽。
2. Express API：玩家、後台、OAuth、SSE、金流與靜態網站。
3. 背景排程：直播觀看／待機室、會員同步、世界王、面板維護、記憶體監控等。
4. 共用 service context：Discord 與 API 使用同一組服務及 Mongo repositories。

`API_ONLY=1` 可略過 Discord command registration 與 gateway login，但 API 仍會啟動。

## 主要資料流

```text
Discord interaction ─┐
                     ├─> handler / Express route
Player Web App ──────┘          │
                                v
                         serviceContext
                                │
                ┌───────────────┼────────────────┐
                v               v                v
          shared combat     domain services   realtime/SSE
                │               │
                └───────┬───────┘
                        v
                Mongo repositories
                        v
                     MongoDB
```

戰鬥結果不由 Discord 或 React 自行計算。主要入口把玩家、裝備、效果與怪物資料交給 `src/shared/combatLoop.js`，再由 service／repository 結算任務、獎勵與持久化。

## 目錄責任

```text
src/
  index.js                         啟動、初始化與 HTTP listen
  config.js                        環境設定與正式環境安全檢查
  api/
    server.js                      Express middleware、路由掛載、SPA
    routes/                        玩家、管理、故事、金流、直播等路由
    middleware/                    JWT／管理權限
  bot/
    client.js                      Discord client、事件、背景排程
    commands.js                    斜線指令定義
    handlers/                      玩家互動與 Discord 結算入口
  services/                        領域服務與交易流程
  shared/                          戰鬥、屬性、效果、區域、職業等共用規則
  repositories/                    repository factory
  adapters/mongo/                  Mongo 實作、連線、索引、request cache
  web/public/                      後台、overlay、靜態頁、玩家 SPA build
scripts/                           種子、遷移、修復、模擬、驗證與維運
docs/                              現行文件、提案與歷史快照
design-system/                     後台視覺規範
```

## 儲存層

目前 runtime 為 **MongoDB-only**：

```text
createServiceContext()
  -> createRepositories()
  -> createMongoRepositories()
  -> getMongoDb()
```

沒有依 `STORAGE_DRIVER` 選 JSON adapter 的執行分支。repo 內的 JSON 主要用途是資料來源、匯出、備份、模擬 fixture 或歷史遺留，不能用來判定線上現況。

Mongo 啟動時建立玩家、進度、交易、任務、怪物、直播事件、戀雀預測與故事等索引；部分高頻資料使用 TTL，唯一發放／交易使用 unique index 或原子條件避免重複。戀雀券錢包、投注單與台帳使用獨立 collections，下注、派彩及退款透過 MongoDB transaction 同步完成，不接觸 RPG 金幣或鑽石。

## 介面層

### Discord

- 斜線指令只負責發布面板、管理操作與診斷；主要玩家流程走按鈕／選單。
- 互動入口集中在 `src/bot/client.js` 分流到 `src/bot/handlers/`。
- 長操作先 acknowledge，再 edit／follow-up；權限與 ephemeral 回覆由 handler 控制。
- 頻道版位由 MongoDB `channelLayout` 映射 feature key，不應把所有頻道 ID 寫死在 view。

### Express

`src/api/server.js` 依序掛載 health、管理 Session／Studio、管理、直播、玩家、故事、麻將、綠界與周邊商城路由；實際 endpoint 以 `src/api/routes/*.js` 為準。管理 Session 在既有 `/admin/*` 路由之前驗證並橋接舊 Bearer guard，管理異動也在同一層寫入稽核紀錄。

全域 middleware 包含：

- production CORS allow list
- gzip（排除 SSE）
- `/api` rate limit（排除 SSE 與金流 callback）
- 8 MB JSON body limit
- API contract headers
- request-scoped Mongo read cache
- 統一錯誤回應

### 玩家 Web

React 原始碼在獨立 workspace `~/Documents/equipmentGAME-app`，建置後部署到 `src/web/public/app/`。Express 對 hash assets 使用長快取、對 `index.html` 使用 no-store，並提供 SPA fallback。

本 repository 也保留 `src/web/public/game.html` 等舊／測試靜態頁，但正式根路由優先服務已部署的 SPA。`/test` 會為 `game.html` 注入測試主題，不是第二套正式前端。

### 管理後台

遊戲營運後台是 `src/web/public/admin.html` 與 `admin.*.js`，直接呼叫 `/admin/*`。它涵蓋玩家、帳務、權限、版位、怪物與 NPC 事件、道具、商店、任務、故事、效果、戰鬥設定、附魔、商城與維運操作。

直播營運後台是 `/studio`（`studio.html`、`studio.css`、`studio.js`），集中真實直播／觀看數、活躍留言者、會員、斗內、全服 Buff、世界王、轉盤、戀雀預測、OBS overlay 健康檢查與創作者授權。戀雀預測在獨立工作區手動開盤、封盤、結算與退款；玩家 `/mahjong-live` 由 root route 直接渲染，不掛載 RPG AppShell、角色閘門、戰鬥、通知或遊戲選單，並透過 `/api/mahjong-auth/*` 取得只允許戀雀 API 的專屬 token；OBS 使用獨立透明盤口。OBS 與場景區依各瀏覽器來源實際支援的 query 參數提供內嵌設定器，可直接產生正式網址、測試預覽並複製；密碼與 Overlay 金鑰不寫入 Studio 的 localStorage。轉盤編輯、斗內／觀看／會員門檻、SC 里程碑與永久加成都直接嵌入 Studio；只有玩家與怪物等遊戲本體資料會明確跨站到遊戲營運後台。Studio 與主 `/admin` 每次開啟或重整都固定先顯示密碼輸入，不以既有 Session 自動跳過登入；兩個後台仍共用同一個 HttpOnly 管理 Session，供手動登入後的 API 請求使用。Studio 各工作區使用 hash 保存位置；舊 `/static/live.html` 保留相容但不再持久化明碼密碼。

## 共用戰鬥邊界

- `combatStats.js`：屬性、武器、裝備與被動轉成戰鬥數值。
- `effectEngine.js`：效果定義、套用與堆疊。
- `combatLoop.js`：回合時序、傷害、治療、吸血、狀態、戰報與統計。
- 呼叫端：準備玩家／怪物、選項與 party effects；結束後寫入進度、任務、獎勵與 KDA。

每回合生命變動在該回合的觸發點處理。`healDone` 與 `lifestealDone` 是 combat loop 回傳的實際量，不應由戰報文字或效果描述反推。

## 功能開關與資料設定

開關不全在同一層，判定時要分清楚：

| 類型 | 例子 | 來源 |
| --- | --- | --- |
| 程式硬開關 | 爬塔暫停 | `towerHandlers.js: TOWER_ENABLED` |
| 程式分支鎖 | 二轉劍鬼、盜靈 | `jobAdvancement.js: seasonLocked` |
| DB 功能設定 | 觀看熱度、斗內、SC、會員、賭場 | 對應 Mongo config collection |
| DB 內容啟用 | 怪物、任務、故事章節 | 文件的 `enabled/isActive` |
| 環境開關 | API_ONLY、auto rotate、startup lock | `.env`／`config.js`／啟動碼 |

因此「程式有這個 service」不代表玩家現在能使用；權威文件會同時標示能力與啟用狀態。

目前二轉表有 11 個一轉、13 條二轉，2 條分支鎖定；每個一轉至少仍有一條可用。爬塔公開入口目前暫停，但音無恋可透過共用白名單測試 Discord 與 Web 版本。

## 直播事件架構

```text
OneComme WS/REST ──> commentFetcher ──> streamHandlers / viewerService
YouTube OAuth API ─> youtubeUpcomingService
viewerService ─────> viewerEventsService ──> Discord 開台通知
                                     └────> 全服觀看 Buff / town chat 提示
donation/member events ──────────────> stream records / SC / global Buff
```

- 待機室以 YouTube broadcastId 去重，成功預告後同 ID 不再預告。
- 正式開台以平台＋URL 指紋識別，經連續三輪確認後公告。
- 看板、打卡枠、未來待機室與 stale 枠不算正式直播。
- 通知 claim 存在 MongoDB `viewerState`，避免重啟或多入口重複發送。
- 觀看門檻、冷卻與效果以 DB `serverEventConfig.viewerTiers` 為準。

## 啟動順序

1. 載入 `.env` 並檢查正式環境密鑰。
2. 選擇性啟動 dev mirror，必要時改寫 Mongo URI。
3. 建立 service context 與 repositories。
4. 同步效果預設與任務種子。
5. 註冊 Discord 指令並登入（非 `API_ONLY`）。
6. 初始化全服 Buff、清理殘留觀看 session、同步直播活動設定。
7. 初始化附魔快取。
8. 建立 Express，開始 listen。
9. Discord ready 後啟動 OneComme、觀看評估、YouTube 待機室、會員與其他排程。

## 部署

- 預設 API port：5566，可由 `API_PORT` 覆蓋。
- PM2 process：`equipmentGAME`，指令見根目錄 README。
- 玩家與後台由同一 Express origin 提供；正式 domain 經 Cloudflare tunnel 導入。
- 前端 build 與後端 restart 是不同步驟；只改 React 原始碼但未 deploy，後端不會自動取得新版。
- 啟動時自動重發面板被硬關閉，避免 Discord rate limit 與孤兒面板；需在後台手動發布。

## 文件與驗證

- `npm run status:update`：從程式與 MongoDB 生成資料現況。
- `npm run check:docs`：核對 MongoDB-only、爬塔與二轉硬事實。
- `npm run check`：語法、行數與文件一致性。
- 相關功能另跑 `test:features`、`test:systems`、`test:golden`、任務與直播通知測試。

提案與歷史文件不納入執行架構；分類規則見 [docs/README.md](README.md)。
