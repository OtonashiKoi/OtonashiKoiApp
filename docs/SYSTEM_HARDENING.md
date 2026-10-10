# 共用結算、runtime 與發布邊界

> 狀態：現行程式實作說明；2026-10-08。部署狀態須另外核對實際執行版本。

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

續約失敗、所有權被替換或超過本機單調時鐘期限時，程序立即停止；HTTP 入口同樣檢查所有權。租約不靠 TTL 刪除判定有效性。正常關閉先讓入口暫存新請求，再排空已轉送的有限HTTP請求，關閉API與SSE後退出。租約記錄機器本地識別及PID；下一程序只在識別相同且作業系統確認舊PID已不存在時，以owner／hostId／pid條件原子接手，無需等待60秒。舊程序仍活著、外部主機、無識別舊紀錄或无法確認時仍保留到期保護，不提前放掉仍可能寫入的程序。

這是保護現有單程序假設的啟動防護，不是分散式戰鬥鎖或跨程序事件匯流排。記憶體房間／排隊不承諾重啟後保留；已持久化的怪物轉場與貨幣操作可恢復。

## 網頁入口與短暫交接

正式路徑為Cloudflare tunnel → `equipmentGateway`（127.0.0.1:5568）→ `equipmentGAME`（5566）。入口代理獨立運行，`pm2 restart equipmentGAME` 不會停止它；不在代理內載入遊戲服務、不持有遊戲租約。`ecosystem.gateway.config.cjs` 定義代理程序，既有 `ecosystem.config.cjs` 透過機器本地Unix socket設定通知暫停／恢復；socket僅擁有者可讀寫，不提供公開管理路由。

關機先暫存新請求、等已轉送請求完成；SSE不阻擋交接，由客戶端重新連線。新API完成資料恢復及必要快取後立即開始接聽並恢復轉送，Discord註冊／登入隨後非同步執行，失敗30秒後重試。資料恢復不跳過，不以刪除租約代替確認舊程序死亡。首次舊版遷移先驗證相同執行程序與租約跨過一次心跳，再確認該PID退出後，只讓相同owner的舊租約到期。

代理只暫存尚未轉送的請求（最多512筆、最長15秒），使用串流背壓保留原始請求內容。送進後端的寫入遇到中斷不自動重送，避免扣款或操作重複；GET／HEAD無回應且無請求內容可在同一等待期限內重試。真正故障或超過容量／期限仍回503，不能將短暫交接保護說成任何故障都保證不中斷。這次未改戰鬥重啟恢復規則；已保存的傷害、消耗、獎勵沿用既有收據恢復，記憶體中的戰鬥仍可能被標記停止。

2026-10-08隔離實際程序驗收：SIGTERM→新API就緒766ms、最長請求778ms、零失敗，包含舊PID保護、SIGKILL後接手、外部主機保護、並行競爭只有一個owner、Discord故意等待60秒時Web仍先就緒。代理測試含排空寫入、暫存12筆POST原始內容、暫停／恢復、SSE、取消、逾時及模糊寫入不重送；貨幣結算與租約回歸通過。

首次正式遷移公告 `1557679610689224717` 送達後執行，36次內外health檢查全部200；入口最長等待3216ms，新API本身啟動1057ms，沒有502。首輪包含舊格式租約的一次性遷移與兩次PM2操作。公告 `1557680988442861570` 送達後另以普通 `pm2 restart equipmentGAME` 驗證：11次內外請求全部200，本機入口最長2504ms、外網最長3052ms；新API啟動2033ms，未再等待60秒租約。正式測得仍約3秒短暫等待，未宣稱穩定低於1秒或戰鬥記憶體無縫續接。證據位於repository外 `game-backups/seamless-runtime-20261008/`。代理與通道程序已存入PM2啟動清單；既有RSS過高導致的自動重啟成因未在本輪修復。

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

- `npm run check` 包含行數檢查：新 `src/**/*.js` 檔案最多 400 行；既有超長檔案以 `scripts/line-limit-baseline.json` 記錄的行數為上限，不能再增加。新增功能應抽出小模組；基準更新只用於核對既有超長檔案與接受已縮短的行數，不用來放寬本次新增程式。
- `npm run test:system-hardening`：replica set 原子性、standalone 並發與三個中斷點恢復、runtime 所有權、共用擊殺流程。
- `npm run test:job-transfer`：轉職扣款與重複操作相容性。
- `npm run test:golden`、`test:combat-regressions`、`test:worldboss-chests`、`test:web-battle-transition`、`test:web-death-cooldown`：原有戰鬥行為。
- SPA `npm run test:deploy`：首次遷移、完整性、舊資源保留、失敗不切換、回復與損壞拒絕。

## 一般區擊殺、換怪與獎勵

一般區死亡後 650ms 退場、接續 1500ms 行走，以同一個死亡時間排程下一隻。前端行走不等獎勵或圖片解碼；後端也不等待金幣、EXP、掉落入帳才準備下一隻。

`normalLiveSettlement` 在擊殺時先保存獨立的 `normalLiveSettlements` 紀錄（怪物、實際傷害／支援、角色、獎勵資料及重試計畫），立即推進換怪並釋放戰鬥結果給資源結算。獎勵另外執行，既有金幣、EXP、物品 receipt 防止重試重複入帳。舊獎勵只可改寫該擊殺的紀錄，不可改寫目前怪物或較新的戰鬥／冷卻。重啟時恢復尚未完成的紀錄；換怪已寫入時不可再推進一次。世界王的冷卻與原結算流程維持其既有規則。

出戰更新隊伍光環只原子修改光環欄位，並檢查場次與原光環版本，不得用整份舊狀態覆蓋 HP、參戰者或轉場。若已完成獎勵的場次仍停在原擊殺計數、原怪物且 HP 為零，恢復器可補完轉場；已進入下一場則不再推進，已完成的獎勵不重發。

怪物掉落表與道具資料在戰鬥開始時預先讀取，擊殺時依實際參戰者、支援、倍率完成個人獎勵。開打不代表已取得擊殺獎勵。`scripts/test-normal-live-detached-settlement.js` 在隔離 MongoDB 刻意阻塞 EXP，確認下一隻準時出現、同一角色可以加入下一隻、延遲獎勵不覆蓋新狀態及重試不重複發放。

### 掉落收據容量

掉落完整 receipt 內容保存於 `normalLiveRewardReceipts`，以角色／賽季／獎勵 ID 唯一識別。角色文件只追加 receipt ID 與實際背包道具，二者同一次原子更新，故部分 bulk 失敗後重試不重複加物。若舊的內嵌 receipt 導致 MongoDB 單筆 16 MB 超限，先複製每筆完整歷史內容並逐筆核對 BSON 雜湊，再以 updatedAt CAS 把內嵌副本改成 receipt ID；不改寫背包、數量或其他角色欄位。找不到完整 receipt 或核對不符時停止搬移。

隔離測試實際製造接近 16 MB 的角色文件，驗證 MongoDB 拒絕新掉落後仍可完整保存歷史收據、縮小角色文件、補發原本物品，並重試防重。獎勵入帳失敗保留獨立擊殺紀錄，不能阻擋正式 API 啟動或下一隻怪物。

### 角色收據容量與搬移原子性（2026-10-08）

一般角色讀取不攜帶歷史 EXP、掉落、戰鬥資源收據。`progressReceiptLedger` 將已提交的四類收據保存於 `progressReceipts`（以玩家、賽季、種類、操作 ID 雜湊作 `_id`）；每類超過 256 筆時保留最近 64 筆於角色文件，其餘逐筆寫入並比對 BSON 後才搬離。EXP、掉落及資源重播同時查詢近期與永久紀錄，因此不會因搬移重複發放。掉落的完整明細仍保存於 `normalLiveRewardReceipts`。

搬移只移出已驗證的陣列前綴，保留搬移期間新追加的收據，並增加 `receiptEpoch`。發獎寫入與資源提交檢查該版本，EXP 另保留 `updatedAt`／賽季／角色槽 CAS；一般 `save`、`saveIfUnchanged`、`updateFields` 不得覆寫收據及版本。資源結算以單一戰鬥 ID 與欄位更新原子提交。容量檢查在發獎／資源寫入前執行，不等到 MongoDB 的 16 MiB 寫入失敗才處理。

永久收據與已完成結算工作保留歷史，不設 TTL、不刪除玩家資產；總磁碟使用量仍須另行監測，不能將單份角色文件變小視為總儲存量不再成長。`scripts/test-progress-receipt-capacity.js` 使用獨立 QA MongoDB 驗證搬移、舊獎勵重播、版本競態、中斷恢復與舊快照回寫；換怪測試另外驗證 EXP 等待時下一隻仍依死亡時鐘生成。

裝備效果合併以 `itemRepository.findByIds` 一次查詢目前所有裝備 ID，依 ID 對應結果而非依結果順序；不使用跨請求快取。`/api/me/profile` 共用 `getProfile` 已讀取的角色、錢包與最新裝備，避免同一請求再載入兩份完整背包及重複逐件查詢。裝備強化值、實例 UUID 及目前道具庫設計值的優先序不變。

任務週期文件的 `progress._partyOperations` 也採相同容量界線：超過 256 筆時將已提交的舊操作 ID 搬到 `questOperationReceipts`，保留最近 64 筆。一般任務頁不讀取歷史 ID；戰鬥累積時只查當次 ID 的近期／永久防重紀錄，任務進度與收據在同一文件原子提交，搬移版本不符時由原結算重試。既有任務領獎更新不覆寫這些紀錄，legacy weekly 文件仍可寫入。驗證入口為 `scripts/test-quest-receipt-capacity.js`。

同一份 `normalLiveSpawnAt`／怪物序號代表同一場生成；若 GET 場景已在 Mongo 儲存後先公布下一隻，稍後完成的 `saveState` 強制公布不得重新產生 encounter ID 或清空已開始的傷害／事件。`scripts/test-live-scene-spawn-id.js` 重現此交錯，並確認之後同種怪物的新一場仍取得不同 ID。背包 API 的道具庫補齊同樣改為一次批量讀取，保留所有實例及最新顯示欄位。
