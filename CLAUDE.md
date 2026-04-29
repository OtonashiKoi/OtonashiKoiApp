# equipmentGAME - AI 協作指南

> 本檔案只保留穩定規則與「如何取得最新現況」。遊戲資料請以 MongoDB 生成文件為準，不要相信手寫舊記憶。

## 開始工作前
- 先執行 `npm run status:update`，從 MongoDB 重新產生 [docs/CURRENT_GAME_STATUS.md](docs/CURRENT_GAME_STATUS.md)。
- 需要判斷怪物、道具、任務、職業現況時，優先看 `docs/CURRENT_GAME_STATUS.md`。
- 不要讀取、搜尋、分析、修改或引用 `archive/**`，除非使用者明確要求。
- 工作前可看 `git status --short`，但不要還原不是自己造成的變更。

## 溝通與交付
- 與使用者溝通一律使用繁體中文。
- 功能不要做一半就結束；結束前要確認「入口、後台/API、Discord 互動、資料落地、錯誤處理、驗證」是否都完成。
- 需要移除、瘦身、刪檔、刪程式、刪依賴、刪資產前，先用白話說明用途並取得使用者同意。
- PM2 啟動/重啟通常由使用者操作；需要時提醒使用者跑 `npm run pm2:reset`。

## 自動更新現況
```powershell
npm run status:update
```

這個指令會直接掃 MongoDB：
- `monsters`
- `items`
- `weeklyQuests`
- `players`
- `progress`
- `worldBossConfig`
- `worldBossState`

輸出內容：
- Zone 與怪物清單
- 道具分類、階級、槽位與完整道具表
- 任務清單，包含新手、職業、每日、每週
- 職業徽章與職業任務條件
- 世界王設定與狀態數量

## 技術架構
- Runtime：Node.js 20+
- Bot：Discord.js
- Web/Admin：Express + `src/web/public`
- DB：MongoDB `equipment_game`
- Mongo 連線：`src/adapters/mongo/createMongoClient.js`
- Zone 單一來源：`src/shared/zones.js`
- 戰鬥核心：`src/shared/combatLoop.js`、`src/shared/combatStats.js`、`src/shared/effectEngine.js`

## 主要目錄
```text
src/
  api/routes/          Express API
  bot/                 Discord Bot UI/handlers
  domain/              Domain model helpers
  services/            Game services
  shared/              Shared combat, zones, formulas
  web/public/          Admin and web UI
scripts/               Maintenance and migration scripts
docs/                  Generated and design docs
```

## 重要注意
- `item.id` 是系統 UUID，`item._id` 是 MongoDB ObjectId，兩者不要混用。
- 怪物區域不要 hardcode，請使用 `src/shared/zones.js`。
- 任務系統目前統一在 `weeklyQuestService`，`cadence` 包含 `onboarding`、`job`、`daily`、`weekly`。
- 職業徽章是 `itemType: "job_badge"` 且裝備槽位是 `job_eq`。
- 怪物卡實際要能裝備時，資料要走可裝備卡片/特殊槽位邏輯，不要只新增不可用收藏品。
- 新增或修改資料庫內容後，記得跑 `npm run status:update` 讓文件同步。

## 常用指令
```powershell
npm run status:update  # 重新產生目前遊戲資料總覽
npm run check          # 語法與行長檢查
npm run pm2:reset      # 重啟服務，通常由使用者操作
npm run pm2:logs       # 查看 PM2 logs
```
