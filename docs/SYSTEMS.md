# 系統索引 SYSTEMS

> 狀態：現行程式索引。最後核對：2026-08-10。
>
> 執行事實以 `src/**` 與目前 MongoDB 為準。資料數量與 DB 開關請先執行 `npm run status:update`，再看 [CURRENT_GAME_STATUS.md](CURRENT_GAME_STATUS.md)。

## 核心入口

| 責任 | 程式入口 |
| --- | --- |
| 啟動與 runtime 初始化 | `src/index.js` |
| Discord client、互動與排程 | `src/bot/client.js`、`src/bot/commands.js`、`src/bot/handlers/` |
| Express、middleware、SPA | `src/api/server.js`、`src/api/routes/` |
| 服務組裝 | `src/services/createServiceContext.js` |
| 儲存層 | `src/repositories/createRepositories.js` → `src/adapters/mongo/createMongoRepositories.js` |
| Mongo 連線與索引 | `src/adapters/mongo/createMongoClient.js` |
| 戰鬥 | `src/shared/combatLoop.js`、`combatStats.js`、`effectEngine.js` |
| 區域 | `src/shared/zones.js` |
| 二轉 | `src/shared/jobAdvancement.js` |

目前是 **MongoDB-only**。`config.storage.jsonDataPath` 與 JSON 檔仍可能被資料腳本使用，但 `createRepositories()` 沒有 JSON runtime 分支。

## 戰鬥與玩法

### 區域討伐

- 服務：`src/services/monster/monsterService.js`
- 共用戰鬥：`src/shared/combatLoop.js`；玩家衍生屬性：`combatStats.js`
- Discord：`src/bot/handlers/monsterZoneHandlers.js`、`src/bot/monsterZoneView.js`
- Web API：`src/api/routes/playerAppRoutes.js` 的 `/api/combat/*`
- 後台：`adminMonsterRoutes.js`、`adminCombatCalculatorRoutes.js`
- Web 夏日活動分頁從選關列表開始使用 `uploads/zones/event_1.webp`，實際活動戰鬥沿用同一場景並以版本參數避開舊快取
- 資料：`monsters`、`monsterState`、`battleConfig`、`effectDefinitions`

### 世界王與 KDA

- 共用服務：`src/services/worldBoss/worldBossService.js`
- 實例組裝：`createServiceContext.js`
- 目前四個 boss key：`default`（大史王）、`dragon_king`（古龍王）、`hellfang_king`（地獄狼牙王）、`island_turtle`（島島龜王）
- 常態前置鏈：大史王 → 古龍王 → 地獄狼牙王；島島龜王沒有前置王
- 單人王：`src/api/routes/soloBossRoutes.js`；`accountSoloBoss` 位於帳號頂層，人物 1／2／3 共用每日擊殺上限與部位進度；舊人物快照會在首次讀取時合併
- KDA：`src/services/kda/kdaService.js`；戰內歸戶在 `combatLoop.js` 的 `assistLedger`
- 世界王暈眩條：`src/shared/dwarfStunGauge.js`
- Web 戰鬥 UI：獨立顯示世界王總血量／機制狀態，部位名牌與傷害數字不覆蓋機制面板；世界王選怪卡與進場前的部位頁會透過 `/api/worldboss/status` 顯示龜王的安全、詠唱、海嘯、破綻與逐秒倒數，海嘯中出擊鈕改為紅色「進場即死」警告但仍可點擊；`battleStore.buildTimeline()` 保留完整戰報並把每條非回合事件轉為語意時間軸，`BattleLayer` 以頭像光環、效果圖示、短提示、數值跳字與受擊反應同步播放，未知技能落到通用 skill 演出；合併連擊與怪物多段攻擊會拆回逐段動畫，殘影亂舞顯示五個傷害數字，血量與總傷害仍只採伺服器結算；所有戰鬥畫面依 9:16 戰鬥面板本身高度（低於 900px／780px）分級縮放戰報、角色／怪物、血條、集氣／機制條、COMBO 與中央戰鬥鈕，隊友泡泡下移以降低遮擋；戰報預設展開、可收合成小列，選擇以瀏覽器 localStorage 保存
- 島島龜王的 Web 戰鬥背景由 `uploads/zones/event_boss.webp` 提供，與夏日活動區維持同一套海島遺跡場景
- 島島龜王沿用四部位 key 以相容世界王引擎，但顯示名稱固定為 `head=龜首`、`body=島背`、`wings=左鰭`、`legs=右鰭`；古龍王的 `wings` 才顯示龍翼
- 島島龜王海嘯由 `src/shared/turtleTide.js` 統一驅動：開戰後每 3 分鐘檢查一次，總血 70%／30% 各強制一次；詠唱 3 分鐘期間全部位可攻擊但全身承傷僅 1%，冰凍與暈眩累積 ×2；詠唱完成時仍在戰鬥中的玩家會在對應回合被真海嘯命中，海嘯 3 分鐘內新進場者則開場即死；打斷或海嘯結束後皆有 30 秒 ×1.3 破綻
- 資料：`worldBossConfig`、`worldBossState`、`worldBossChestGrants`、`kdaSeasonStats`、`worldBossStunGauge`

### 爬塔

- 現況：**公開暫停，音無恋白名單測試中**；一般玩家仍不可進入
- 總開關：`src/bot/handlers/towerHandlers.js` 的 `TOWER_ENABLED = false`
- 測試白名單：`src/shared/towerAccess.js`；Discord 與 Web API 都使用同一判定
- 站位：坦（HP×1.3／ATK×0.7／光環×0.5）、補（HP×0.7／ATK×0.7／光環×1.3）、輸出（HP×1／ATK×1.2／光環×0.5）
- 怪物依 AGI 進入行動軸，存活目標優先順序為坦 → 補 → 輸出；同站位按入隊順序
- 已移除所有塔專屬職業／二轉光環，改用一般戰鬥區域的裝備與職業隊伍光環，再依站位倍率縮放
- 規則：`src/shared/towerConfig.js`、`src/shared/towerRoles.js`；組隊房：`src/services/tower/towerPartyRooms.js`
- 共 71 層；70、71 層皆為煉獄烈焰狼王(B)

### 其他玩法

| 系統 | 核心程式 | 主要資料 |
| --- | --- | --- |
| 掛機 | `services/idle/idleService.js`、`playerIdleRoutes.js`、`adminIdleRoutes.js` | `idleZones`、`idlePlayerStates` |
| PK | `shared/pkCombat.js`、`bot/handlers/pkArenaHandlers.js` | `pkArenaState` |
| 賭場 | `services/casino/casinoService.js`、`bot/handlers/casinoHandlers.js` | `casinoState`、`casinoRounds` |
| 寵物 | `services/pet/petService.js`、`bot/handlers/petHandlers.js` | `progress.pets`、`progress.petDex` |
| 麻將 | `services/mahjong/`、`api/routes/mahjongRoutes.js` | runtime queue state |
| 主線故事 | `services/story/storyService.js`、`api/routes/storyRoutes.js` | `storyChapters`、`storyNpcs`、`progress.storyProgress` |

## 道具、經濟與成長

| 系統 | 程式 | 資料／備註 |
| --- | --- | --- |
| 背包與換裝 | `services/item/itemService.js`、`services/shop/shopService.js`、`playerAppRoutes.js` | `items`、`progress.inventory/equipment`；支援使用、丟棄、出售、鎖定與批次操作 |
| 背包容量 | `services/backpack/backpackService.js` | 主要戰鬥入口會在背包滿時阻擋 |
| 強化與屬性洞 | `services/enhance/`、`api/routes/playerAppRoutes.js`、`api/routes/playerForgeRoutes.js` | 寶石強化；D1/C2/B3/A4/S5 屬性洞；屬性鑲嵌與破壞拆除。拆除次數永久保存在 `progress.inventory/equipment[].elementRemovalCount`，最多成功 3 次 |
| 附魔 | `services/enchant/enchantService.js`、`playerEnchantRoutes.js`、`adminEnchantRoutes.js` | 設定快取於啟動初始化；Web 重骰在送出 API 前有消耗確認 |
| 商店 | `services/shop/shopService.js` | `shopItems`、`shopClaims` |
| 拍賣 | `services/auction/auctionService.js` | auction repository |
| 錢包／發獎 | `walletService.js`、`rewardService.js`、`transactionService.js` | `wallets`、`transactions` |
| 周邊商城 | `services/merch/merchService.js`、`api/routes/merchRoutes.js` | `merchItems`、`merchOrders`、綠界付款 |
| 等級 | `services/progress/progressService.js`、`shared/progression.js` | Lv.50；溢出 EXP 轉金幣 |
| 打卡 | `services/checkin/checkinService.js` | `checkins` |
| 邀請碼 | `services/invite/inviteService.js` | `inviteCodes` |
| 會員 tier | `services/playerTier/playerTierService.js` | `playerTiers` 與 Discord role |

## 任務與職業

### 任務

- 服務：`src/services/weeklyQuest/weeklyQuestService.js`
- cadence：`onboarding`、`job`、`daily`、`weekly`、`season`
- 玩家／後台 API：`src/api/routes/adminWeeklyQuestRoutes.js`
- 資料：`weeklyQuests`、`weeklyQuestProgress`
- 任務 type 的可接受清單與記錄行為在 `weeklyQuestService.js`；不要從舊文件手抄一份常數表
- 戰鬥任務入口：Discord `monsterZoneHandlers.js`、Web `playerAppRoutes.js`
- Web 任務首頁一次抓五種 cadence 時，共用同一份任務定義、玩家狀態與二轉資格快照，只平行讀取各週期進度；領獎驗證也沿用單一玩家快照
- Web 戰報只等待傷害、怪物狀態與玩家獎勵等核心結算；任務／熟練度／通行證及 Discord 面板通知在背景依玩家序列化。戰鬥任務指標透過 `weeklyQuestService.recordProgressBatch()` 合併處理
- 賽季通行證戰鬥點數由 Discord `monsterZoneHandlers.js` 與 Web `playerAppRoutes.js` 的區域階級表傳給 `passService.addPointsForKill()`；級距為 D1／C2／B3／A5／S6，活動小怪區 `event_1` 對齊古城深處採 A 級、非落敗每場 5 點

治療相關現況：

- `heal_done`：實際補回的非吸血 HP；滿血溢補、治療轉傷害、治療免疫不計
- `lifesteal_done`：實際吸血補回的 HP；滿血溢出不計
- 當回合治療在當回合開始／觸發點結算並寫戰報，不以開場效果說明冒充治療紀錄

### 一轉與二轉

- 單一來源：`src/shared/jobAdvancement.js`
- 現有 11 個一轉、13 條二轉分支；每個一轉至少 1 條可用
- 目前 2 條分支鎖定：劍鬼、盜靈；其餘 11 條可由任務／故事流程開放
- 徽章熟練度：`src/shared/jobBadgeLevel.js`、`services/job/jobBadgeService.js`
- 二轉費用、條件、同職分支互斥與 `seasonLocked` 都由 `jobAdvancement.js`／`weeklyQuestService.js` 判定
- 故事轉職節點：`services/story/storyService.js`
- 各職機制：`dwarfStunGauge.js`、`shadowGauge.js`、`zoneCombo.js`、`battleStance.js`、`sunSpirit.js`、`jobBattleOptions` 等

## 直播、聊天與全服事件

### OneComme 與直播事件

- 留言／meta 接收：`src/bot/commentFetcher.js`
- 斗內與綁定處理：`src/bot/handlers/streamHandlers.js`
- OneComme 接收仍是必要 runtime 管線；已移除的是不需要的「玩家查詢直播留言」產品功能，不是整個 listener
- SC 與會員里程碑的各階加成會疊加並保留到本季結束；換季時清除，玩家介面統一標示為「本季保留」
- 直播資料記錄：`services/stream/streamRecordsService.js`
- 會員同步：`services/stream/membershipTracker.js`
- 斗內、會員、SC、觀看門檻設定：`services/stream/streamEventConfig.js` + MongoDB `serverEventConfig`
- Buff：`services/stream/globalBuffService.js`

### 待機室與開台通知

- YouTube 待機室：`services/stream/youtubeUpcomingService.js`
  - OAuth API 預設每 2 分鐘查 upcoming；最短可設 1 分鐘
  - OneComme 若先提供 upcoming meta，也會走同一個 broadcastId 去重
  - public／unlisted 且有未來預定時間才公告；同 broadcastId 成功後不重發
- 正式開台：`services/stream/viewerEventsService.js`
  - 排除永久看板、打卡枠、未來待機室與 90 秒未更新的 stale 枠
  - 連續 3 個 20 秒評估輪確認才公告；連續 6 輪離線才釋放鎖
  - 同場 6 小時與全域 10 分鐘冷卻由 `streamNotificationState.js` 保護
- 待機室預告與開台公告都使用 `STREAM_GO_LIVE_CHANNEL_ID`

### 觀看熱度

- 即時狀態：`services/stream/viewerService.js`
- 規則與廣播：`viewerEventsService.js`
- 目前 DB：30／40／50 人三階，掉寶／金幣／經驗分別 +5%／+8%／+10%
- 同場同階只公告一次；更高階可補公告，但任何觀看提示仍至少間隔 60 分鐘
- 直播中持續延長，離線後依 `graceMinutes` 自然過期；不降階、升階覆寫
- 手動「立即宣傳」只發訊息，不改 Buff

### 聊天、公告與即時推送

- Web ↔ Discord 大廳：`services/chat/`、`playerAppRoutes.js` 的 chat API／SSE
- 公告：`services/announcement/`
- 玩家即時事件：`services/realtime/`、`webPresence`
- 直播 overlay：`streamOverlayRoutes.js`、`chatOverlayHub.js`

## 管理、登入與安全

- Discord OAuth／JWT：`playerAppRoutes.js`、`api/middleware/requireAuth.js`
- 管理權限：`services/admin/accessControlService.js`
- Web ban：`services/access/webBanStore.js`
- 維護模式：`services/access/maintenanceStore.js`
- 後台：`src/web/public/admin.html` 與 `admin.*.js`
- API 防護：CORS 白名單、全站 `/api` rate limit、SSE 例外、正式環境弱密鑰 fail-fast
- 審計：`adminActionLogs`

## Web 與部署邊界

- 玩家 React 原始碼位於獨立的 `~/Documents/equipmentGAME-app`
- build 產物部署到本 repository 的 `src/web/public/app/`，由 Express 直接服務
- `src/web/public/` 同時包含管理後台、overlay、測試頁與其他靜態資源
- 玩家主動送出的 POST／PUT／PATCH／DELETE 會立即顯示全域處理提示；任務領獎與拍賣購買另有可回滾的樂觀畫面更新，最終結果仍以伺服器為準
- Express 會將伺服器處理超過 500ms 的 `/api` 請求記為 `[API SLOW]`，用來區分後端耗時與 Cloudflare／玩家網路往返
- production domain 目前由 Cloudflare tunnel 指向 Express；細節見 [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)
- 重新建置玩家 UI 要在外部前端 workspace 修改、build、deploy；不要直接手改 hash bundle

## 驗證

- 全域：`npm run check`
- 文件：`npm run check:docs`
- 核心資料／功能：`npm run test:features`、`npm run test:systems`
- 戰鬥：`npm run test:golden`
- 職業／任務：`npm run test:job-transfer`、`npm run test:anchor-quest-metrics`、`npm run test:quest-progress-batch`
- 直播通知：`npm run test:stream-notifications`
- DB 快照：`npm run status:update`
