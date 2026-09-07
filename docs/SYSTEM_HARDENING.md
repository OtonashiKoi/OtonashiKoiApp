# 共用結算、runtime 與發布邊界

> 狀態：現行程式實作說明；2026-09-07。部署狀態須另外核對實際執行版本。

## 貨幣結算

`RewardService.grantCurrency` 必須使用儲存層的 `grantCurrencyAtomic`；沒有不安全的先改餘額、再補紀錄後備路徑。

- Replica set / mongos：錢包增減與交易紀錄在同一個 MongoDB transaction 中提交。
- Standalone：`currencyOperations` 先保存操作；錢包中的 `_currencySettlement` 同時保存原子餘額變動與待送出的交易紀錄。紀錄補入 `transactions`、操作標記完成之後才清除錢包標記。
- 同一錢包的並發操作可以協助完成前一筆；每次取得錢包標記都有不同 token，過期的協助者不能更新下一次標記。
- 啟動時先恢復未完成操作，成功後才啟動服務與排程。餘額不足是持久化拒絕結果，不會因稍後入金而讓相同操作自動扣款。
- Standalone 操作保存預約時的錢包賽季；若重啟恢復時已換季，未套用的舊金幣操作會以 `STALE_SEASON_WRITE` 拒絕，不能灌回新賽季。
- 通知發生在結算完成後；通知失敗不改變交易成功結果。
- 非空 `source + sourceRef` 是操作的唯一識別。相同識別、相同玩家／幣別／金額重試會回傳原交易；不同內容回傳 `IDEMPOTENCY_CONFLICT`。
- 未提供 `sourceRef` 代表每次呼叫都是新操作，不能用相同金額猜測重複交易。需要重試的上層業務必須保存並沿用穩定的操作識別。
- 新的有識別交易永久保留；沒有識別的打怪紀錄，以及完成的 standalone 無識別操作日誌，沿用三天保留策略。未完成操作不設 TTL。

範圍是 `RewardService` 的金幣／鑽石增減及對應交易紀錄。EXP、物品、拍賣整筆交付、所有世界王獎勵的整場原子性不屬於這個 API 的保證；不得把單筆貨幣一致性稱為所有資產操作都已交易化。

主要實作：`src/adapters/mongo/currencySettlement*.js`、`standaloneCurrencySettlement.js`、`src/services/reward/rewardService.js`。

## 共用戰鬥服務

`src/services/battle/zoneBattleService.js` 是 Web 與 Discord 共用的領域入口，包含：

- 世界王部位、弱點與階段規則。
- 一般怪／世界王擊殺入口與原有 DB claim。
- 金幣及 EXP 分配、掉落、寶箱、任務進度與怪物轉場。

擊殺分為 `grantKillCurrencyAndExp`、`grantKillDrops`、`finishMonsterKill`，每個新檔案維持 400 行內。數值公式仍以 `shared/combatLoop.js` 為準。

`battlePresentation` 是公告、私訊、面板與 Discord 排隊清理的回呼介面；Discord handler 安裝實際處理器。沒有 Discord 的測試可直接帶入 `serviceContext` 執行擊殺結算。既有 handler 匯出仍保留相容，但 Web 不再 require 該 handler。

Web 請求準備與戰報組裝仍位於 `playerAppRoutes.js`，Discord 互動與戰報播放仍位於 handler；本次沒有重寫戰鬥公式，也沒有把整個 HTTP router 全部拆完。

## 單一 runtime 所有權

目前仍是單一遊戲 runtime，PM2 固定 `fork / instances: 1`。戰鬥互斥、SSE、在場名單與部分房間仍使用程序記憶體；不支援直接水平擴容。

`runtimeLeases._id = game-runtime` 以 MongoDB 伺服器時間維持 60 秒租約，每 10 秒續約。取得所有權之前不組裝遊戲服務、不登入 Bot、不啟動遊戲排程。第二個程序最多等待 70 秒，仍無法取得就退出。`API_ONLY` 也要取得同一資料庫的租約；獨立測試必須使用不同資料庫。

續約失敗、所有權被替換或超過本機單調時鐘期限時，程序立即停止；HTTP 入口同樣檢查所有權。租約不靠 TTL 刪除判定有效性。正常關閉先排空 HTTP 寫入，租約留到期滿，避免仍在關閉中的背景工作與新程序重疊。**因此重啟可能額外等待最多約一分鐘，不是零停機部署。**

這是保護現有單程序假設的啟動防護，不是分散式戰鬥鎖或跨程序事件匯流排。記憶體房間／排隊不承諾重啟後保留；已持久化的怪物轉場與貨幣操作可恢復。

## 前端發布與回復

在 `equipmentGAME-app` 執行：

```sh
npm run build
npm run deploy:no-build
```

建置時產生 `dist/source-build.json`，保存前端 commit、工作目錄是否有未提交變動與建置時間。`--skip-build` 若缺少來源資訊會拒絕發布。

發布會在主 repository 的 `src/web/public/.app-releases/<buildId>/` 準備完整版本，驗證檔案雜湊與 index 引用資源，再切換 `.app-current` 符號連結。舊版 hash assets 保留，避免尚未重整的頁面載入舊 lazy chunk 時失敗。`build-info.json` 同時記錄前端建置資訊、發布時後端 commit 與 dirty 狀態；它不是後端二進位快照，也不是已提交版本的保證。

首次發布先把既有 `app/` 複製為可回復版本，原有 Git 追蹤檔案保持原位。API 優先服務 `.app-current`，尚未部署的 checkout 使用 `app/` 後備。版本之間使用原子連結替換；入口與版本目錄不提交 Git，也不自動刪除。

回復指定版本：

```sh
node scripts/deploy-to-main.mjs --rollback=<發布輸出的版本目錄名稱>
```

回復前也驗證完整性；損壞的版本不切換。發布失敗保留原入口。部署互斥檔若因程序中斷而殘留，先確認沒有發布程序，再人工保留／處理該 lock，不可直接忽略互斥。上述連結切換已以本機 macOS 測試；Windows 的連結權限與切換語意需另驗。

前端回復不會回復後端或 MongoDB schema。後端上線應先完成資料備份、停止舊程序、啟動新程序，再驗證 health 與實際操作。

## 驗證

- `npm run test:system-hardening`：replica set 原子性、standalone 並發與三個中斷點恢復、runtime 所有權、共用擊殺流程。
- `npm run test:job-transfer`：轉職扣款與重複操作相容性。
- `npm run test:golden`、`test:combat-regressions`、`test:worldboss-chests`、`test:web-battle-transition`、`test:web-death-cooldown`：原有戰鬥行為。
- SPA `npm run test:deploy`：首次遷移、完整性、舊資源保留、失敗不切換、回復與損壞拒絕。
