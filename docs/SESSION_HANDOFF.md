# equipmentGAME — Web 客戶端工作交接文件

> ⛔ **歷史文件（2026-08-07 審計標記）**：本文件是 `game.html` 單檔客戶端時期（Windows 舊機）的交接紀錄。
> 現行玩家前端是 React app（repo `~/Documents/equipmentGAME-app`，build 進 `src/web/public/app`，共 23 個路由頁），
> `game.html` 檔案仍在但已非主力。路徑、待辦、UX 描述皆以當時為準，僅存檔備查。現況請看 [SYSTEMS.md](SYSTEMS.md)。

> 給「桌面版 / claude.ai」接手用。把這份文件貼上或附加到新對話，就有完整脈絡可以接著做。
> 產生時間：本次 Claude Code session 結束時。專案根目錄：`C:\Users\appsk\Documents\Github\equipmentGAME`

---

## 1. 目標
做一個 **Web 玩家客戶端 `src/web/public/game.html`**，功能**完全比照現有 Discord Bot**，只是介面不同。
- 單一 HTML 檔（含內嵌 CSS/JS，非框架），延續一個戰鬥動畫 POC 的風格。
- 直接接**正式機真 API**（同源）。伺服器：Node + Express + Discord.js + MongoDB，PM2 管理，port **5566**。

## 2. 部署 / 網域（已上線）
- 正式網址：**https://otonashikoi.org/game.html**（web 與 API 同源）。
- 對外靠 **cloudflared 具名通道**：設定在 `C:\Users\appsk\.cloudflared\config.yml`（`otonashikoi.org` / `www` → `http://localhost:5566`）。
- `.env` 的 `PUBLIC_BASE_URL=https://otonashikoi.org`。
- ⚠️ **不要跑 `npm run go-live`**：它會開臨時 trycloudflare 通道並把 `PUBLIC_BASE_URL` 改成隨機網址，蓋掉現在設定。
- 通道目前是「背景 process」在跑；要常駐請用系統管理員執行 `cloudflared service install`。
- **Discord OAuth 網頁登入**：端點 `GET /api/auth/discord/login`（導向 Discord → redirect 回 `/game.html` 帶 `?code` → 前端 POST `/api/auth/discord` 換 JWT）。
  - **待辦**：要在 Discord Developer Portal → OAuth2 → Redirects 加入 `https://otonashikoi.org/game.html`（目前清單只有 `https://otonashikoi.org/` 與一個 github.io，所以登入會報「無效的 redirect_uri」直到加上）。
- 另有 `C:\Users\appsk\Documents\Github\equipmentGAME-app`（React/Vite/Capacitor 專案），`.env.production` 指向同網域、redirect `/auth/discord/callback`。

## 3. 登入機制
- 正式：Discord OAuth（見上）。
- 開發/測試捷徑：`POST /api/auth/discord {code:"mock:<discordId>"}` → 直接回 JWT（存 localStorage `eg_token`）。留空用測試帳號 `1450019975031951370`。
- mock 登入已修正成**從 Discord 抓真實暱稱**（公會暱稱優先），不再一律記成 "WebPlayer"。

## 4. 已完成的功能（game.html，全部接真 API）
- **P1** 登入 + Hub 大廳 + 左側全功能導航 + 角色資料頁
- **P2** 背包 / 裝備欄 / 強化 / 任務中心 / 打卡 / 邀請碼 / 交易紀錄
- **P3** 怪物區（接 `/api/combat/quick-battle`，回傳 `logs`=真實 roundLogs）+ 戰鬥動畫（逐回合播）+ 掛機 + 世界王
- **P4** 金幣商店 / 拍賣場 / 聊天（與 Discord 同步）
- **P5** 賭場命運轉盤（即時）/ 寵物採集 / **單人爬塔** / **PK 擂台（與 Discord 共用同一擂台）**

## 5. 為了上面功能新增的後端端點（`src/api/routes/playerAppRoutes.js`）
原本 DC 有功能但缺玩家 API，這次補上：
- 賭場：`GET /api/casino/state`、`POST /api/casino/bet`
- 寵物：`GET /api/me/pets` + `POST /api/me/pets/{feed,claim,active,release,rename,hatch}`
- 爬塔：`/api/tower/{state,start,fight,retreat}`（單人；伺服器端 session；數值比照 `src/shared/towerConfig.js`；逐層 HP 帶入、繼續/撤退）
- PK：`/api/pk/{state,join,leave,bet,last-result}`
- 網頁 Discord 登入起始：`GET /api/auth/discord/login`

**PK 共用擂台關鍵**：在 `src/bot/handlers/pkArenaHandlers.js` 加了「不依賴 interaction 的網頁入口」（`webGetArenaState/webJoinQueue/webLeaveQueue/webPlaceBet/webGetLastResult` + 結算時 `recordWebPkResult`），**全為附加、不改既有 Discord 流程**，所以網頁與 Discord 操作同一份擂台狀態。

## 6. 哪些資料是「兩邊共通」（網頁 ↔ Discord）
- ✅ 一般打怪區：同一隻世界怪、同一條 HP、同一份傷害排行（quick-battle 直接讀寫同一份 MongoDB 怪物狀態）
- ✅ 世界王、拍賣場、PK 擂台、聊天
- 各自獨立：角色自己的東西（背包/裝備/任務/寵物/單人爬塔 session）

## 7. 尚未做 / 待辦
- **Discord OAuth redirect 註冊**（見 §2，登入要能用的前提）
- **綁定直播 🔗**：唯一剩的 placeholder（stream OAuth，較獨立）
- 已移除：麻將（直播排隊非玩法）、個人房間（DC 是管理員鎖頻道，網頁本身即個人介面）
- **顯示/UX 調整（進行中）**：使用者要逐頁調整版面與閱讀性。已做：手機 RWD、裝備欄分組+戰力總覽、背包分類數量+槽位排序、強化分「已裝備/背包內」。仍要對著畫面逐頁微調（戰鬥動畫的角色目前是 emoji 占位，可換真立繪）。

## 8. 開發工具
- **截圖工具**：`node scripts/web-shot.js --section=<id> --device=desktop|mobile --id=<discordId> --out=tmp/x.png`
  - section: home/inventory/equip/enhance/zones/tower/pk/casino/pet/shop/auction/chat/quests/checkin/invite/txn/worldboss
  - 用 Playwright（`@playwright/test` 已裝，chromium 已下載）。會 mock 登入、注入 token、切到該頁截圖。
- 語法檢查：`node --check <file>`；改完前端可用此檢查內嵌 JS（先抽出 `<script>` 內容再 check）。
- 重啟伺服器：`npm run pm2:restart`（改後端後要重啟）。

## 9. 戰鬥動畫技術重點
- `runCombatLoop` / `runPkCombat` 是**一次算完整場**、回傳 `roundLogs`（字串陣列，每元素一回合）。
- game.html 內有解析器把 roundLogs 轉成動畫時間軸：PvE 用 `bTimeline`（解析「你剩 N HP」/「怪物剩 N HP」/「造成 N 點傷害」/「發動【技能】」），PK 用 `bPkTimeline`（雙方名字，非「你」）。
- 不需要把戰鬥改成可逐步驅動的狀態機；逐層/逐場播 logs 即可。

## 10. 重要規則（使用者偏好）
- 溝通用**繁體中文**。
- 驗證戰鬥效果一律走**真實戰鬥流程**，不要用自製 JS 測試腳本下「沒效果」結論。
- PM2 重啟用 `npm run pm2:restart`（不要 `pm2:reset`）。
- 動到正式機要小心（其他玩家可能在用）；PK 那種共用狀態的改動採「附加、不改既有流程」。
