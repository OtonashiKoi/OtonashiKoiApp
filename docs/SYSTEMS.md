# 系統索引 SYSTEMS

> 狀態：現行程式索引。最後核對：2026-08-15。
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
- 玩家 SPA 的一般討伐換怪不等待下一場 API 回應才更新畫面：`BattleLayer` 先讀取上一場回應已寫入 `zonesQueryKey` 快取的下一隻怪，清掉上一場結算畫面並立即顯示新怪，背景伺服器權威結算回來後再以完整 `BattleData` 接續播放；請求失敗會恢復可操作狀態。全站 API 寫入提示不追蹤 `/api/combat/quick-battle` 與 `/api/me/solo-boss/battle`；戰鬥仍由 `inflightRef`、`battleStarting` 與排隊狀態防止重複送出，其他寫入操作仍使用全站提示
- Web 死亡冷卻由 `src/shared/battleTiming.js` 統一計算為「本場前端播放時間＋30 秒死亡懲罰」；戰鬥層只在播放完成、玩家真正看到敗北時顯示倒數，因此當下仍為完整 30 秒。Discord 則在 `displaySettledBattleResult()` 播完逐回合戰報後才呼叫 `recordDeathCooldown()`，兩端語意一致
- 後台：`adminMonsterRoutes.js`、`adminCombatCalculatorRoutes.js`
- Web 夏日活動分頁從選關列表開始使用 `uploads/zones/event_1.webp`，實際活動戰鬥沿用同一場景並以版本參數避開舊快取
- 資料：`monsters`、`monsterState`、`battleConfig`、`effectDefinitions`

### 世界王與 KDA

- 共用服務：`src/services/worldBoss/worldBossService.js`
- 實例組裝：`createServiceContext.js`
- 目前五個 boss key：`default`（大史王）、`dragon_king`（古龍王）、`hellfang_king`（地獄狼牙王）、`island_turtle`（島島龜王）、`northwind_hutao`（北風雀神・胡桃私測）
- 階段技能由各王 `worldBossConfig.phaseConfig` 的開關獨立控制；三階段只代表血量區間與階段倍率，不會自動授予雷擊術。相容尚未寫入 `lightningEnabled` 的既有資料時，僅大史王第二／第三階段保留原本雷擊，其他四王預設關閉
- 常態前置鏈：大史王 → 古龍王 → 地獄狼牙王；島島龜王沒有前置王。胡桃使用獨立 `event_boss_hutao_preview` 區域與世界王狀態，目前只允許音無恋的 Discord ID 進入；正式開放前不列入 Web／Discord 怪物圖鑑；不覆蓋或移除 `event_boss` 島島龜王，供未來活動王輪替／混流
- 胡桃私測第一階段只上線 13 種 S 階限定武器；共通被動「風向輪轉」跨戰鬥保存步進，依序提供東風命中、南風最終傷害、西風爆擊傷害、北風爆擊率，沒有防禦、破防或無視防禦類效果
- 單人王：`src/api/routes/soloBossRoutes.js`；`accountSoloBoss` 位於帳號頂層，三個人物共用每日擊殺上限與部位進度；舊人物快照會在首次讀取時合併
- KDA：`src/services/kda/kdaService.js`；戰內歸戶在 `combatLoop.js` 的 `assistLedger`，共用效果分類與防禦收益反推在 `src/shared/supportContribution.js`。賽季總計仍保留，新增 `jobStats.<jobId>` 按每場出戰職業記錄 K／D／場次，外部光環與區域窗口的 A 也按提供能力時的職業記錄；舊總計因沒有歷史職業快照不猜測回填
- 助攻口徑：聖靈師／治療師的隊伍增傷與有效治療都計入；兵聖／軍師的 Boss 增傷與怪物破防分開換算；結界師／聖域師按實際擋傷，吟遊詩人／詩人 AGI 光環按傷害當量；神射手掩護箭作為提供者直接 K，不重複列 A 或算給受支援者，部位殘血截斷時所有直傷來源等比例縮放。自己的光環不可自益，EXP／金幣光環不算戰鬥助攻
- 世界王寶箱只依本王戰鬥貢獻 `傷害 + 0.7 × 助攻當量` 排名前 6 名；入場費與累積花費不參與排名。寶箱數量仍依本王有效參與人數及最終名次決定；結算公告優先解析 Discord 顯示名，解析不到只顯示「某位勇者」，不顯示完整或部分 Discord ID
- 世界王暈眩條：`src/shared/dwarfStunGauge.js`；巨神震擊窗口內開始的戰鬥會封鎖世界王整場的普攻、怪物卡技能與階段技能（包含雷擊術）；玩家自傷不屬於怪物傷害。矮人與元素控制條會原子保存本輪所有敲條者，窗口被玩家實際使用時，以受益玩家有效輸出的 10% 作助攻池並按敲條量分帳；聖域條同樣保存所有累積者，按窗口實際擋傷與有效治療分帳。Discord、Web 與單人王入口共用同一歸戶規則
- 元素師炎圈對其餘存活部位的鏡射傷害在 Discord、Web 與單人王使用同一規則，會同步扣除各部位 HP 並計入元素師當場職業的 K
- Web 戰鬥 UI：獨立顯示世界王總血量／機制狀態，部位名牌與傷害數字不覆蓋機制面板；世界王詳情的排行榜預設顯示純傷害，可切換成與寶箱相同公式的貢獻排行，貢獻列同時顯示傷害與助攻拆分；世界王與單人王的亮色選怪卡使用亮底專用深色文字，名稱、屬性、入場費、冷卻與部位標籤維持高對比；世界王選怪卡、進場前部位頁與尚未攻擊的龜王戰鬥畫面都透過 `/api/worldboss/status` 顯示龜王總血、潮汐、安全、詠唱、海嘯、破綻與逐秒倒數，海嘯中出擊鈕改為紅色「進場即死」警告但仍可點擊；`battleStore.buildTimeline()` 保留完整戰報並把每一條非回合內容轉為語意動畫事件，`BattleLayer` 依回合分組，主要攻擊、技能、暴擊、怪物反擊、治療、狀態、格擋與閃避全部照順序播放，不做重點刪減；連擊與怪物多段攻擊的每一段也完整保留；`weaponPresentation` 以後端回傳的 `weaponType` 將所有主手武器分成單／雙手劍、匕首、單／雙手錘、單／雙手斧、單／雙手法杖、弓、骰子與空手演出，`WeaponAttackFx` 負責斬擊、突刺、砸擊、劈砍、魔法、投射及屬性／暴擊演出，持續傷害、反傷與隊友支援不冒用自身武器動畫；同一次玩家攻擊只保留一個主要武器演出，不再疊加頭像環、爆裂底圖及全畫面閃光，合併多段攻擊只有第一段播放整套動畫；元件移除全層混色與大型 drop-shadow，錘擊碎片及常駐同時演出數量亦縮減；設定頁的戰鬥特效開關以 `okoi-battle-visuals` 保存於目前裝置，關閉後停止武器、骰子、職業提示與畫面光效，但 HP、傷害數字、骰點文字及完整戰報仍保留；戰場中央不再另外渲染逐事件短字幕；一般回合固定使用後端依 AGI 回傳的 `tickMs` 時槽並按事件數縮短間隔，骰子武器則以 `combatLoop.diceEvents` 的後端結算骰面保留 620ms 落地時間（重骰 900ms），兩顆傷害骰旋轉彈跳後才播放傷害，賭神命運值滿時另落下一顆金色命運骰；戰鬥層沿用全站 9:16 外框，頂部玩家 HUD 與底部主導覽維持作戰區原尺寸，只有兩者之間的戰場內容使用固定 390×547.33 設計座標並依可用空間套用單一等比例倍率，內部元件不因高度斷點切換位置或被個別裁切；戰報預設展開、可收合成小列，選擇以瀏覽器 localStorage 保存
- 島島龜王的 Web 戰鬥背景由 `uploads/zones/event_boss.webp` 提供，與夏日活動區維持同一套海島遺跡場景
- 島島龜王沿用四部位 key 以相容世界王引擎，但顯示名稱固定為 `head=龜首`、`body=島背`、`wings=左鰭`、`legs=右鰭`；古龍王的 `wings` 才顯示龍翼
- 島島龜王海嘯由 `src/shared/turtleTide.js` 統一驅動：開戰後每 3 分鐘檢查一次，總血 70%／30% 各強制一次；詠唱 3 分鐘期間全部位可攻擊但全身承傷僅 1%，冰凍與暈眩累積 ×2；巨神震擊命中時詠唱條歸零，暈眩結束後從 0 重跑完整詠唱，不開啟破綻；區域冰封仍會打斷詠唱並開啟 30 秒 ×1.3 破綻；詠唱完成時仍在戰鬥中的玩家會在對應回合被真海嘯命中，海嘯 3 分鐘內新進場者則開場即死；海嘯結束後有 30 秒 ×1.3 破綻
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
| 賭場 | `services/casino/casinoService.js`、`bot/handlers/casinoHandlers.js` | `casinoState`、`casinoRounds`；25 格輪盤由 `wheelConfig.WHEEL_SLOTS` 統一提供結算與 Web 動畫，格數固定黃12／綠6／紅4／藍2／紫1，伺服器結果含 `slotIdx`，前端只負責旋轉呈現、不自行開獎 |
| 寵物 | `services/pet/petService.js`、`bot/handlers/petHandlers.js` | `progress.pets`、`progress.petDex` |
| 麻將 | `services/mahjong/`、`api/routes/mahjongRoutes.js` | runtime queue state |
| 主線故事／據點訪客 | `services/story/storyService.js`、`api/routes/storyRoutes.js` | `storyChapters`、`storyNpcs`、`progress.storyProgress`；登入玩家可由 `/api/story/hub-npcs` 取得有立繪且排除音無恋的據點訪客清單 |
| 錨點圖鑑／試煉 | `shared/anchorAcquisition.js`、`shared/anchorQuestRules.js`、`api/routes/playerCollectionRoutes.js`、`services/weeklyQuest/weeklyQuestService.js` | 九件錨點皆有取得提示；聖人試煉不綁抖內，命運之輪為每輪有下注者不論輸贏 3% 且每人限一次 |

## 道具、經濟與成長

| 系統 | 程式 | 資料／備註 |
| --- | --- | --- |
| 背包與換裝 | `services/item/itemService.js`、`services/shop/shopService.js`、`playerAppRoutes.js` | `items`、`progress.inventory/equipment`；支援使用、丟棄、出售、鎖定、批次操作與伺服器權威的一鍵最大 ATK 配裝；自動配裝依目前職業限制武器種類，並保留稱號、職業徽章、卡片與錨點 |
| 多人物與裝備方案 | `services/character/characterService.js`、`shared/membershipEntitlements.js`、`services/shop/shopService.js`、`api/routes/playerPresetRoutes.js` | `progress.activeCharacterSlot/characterSlots/activePreset/equipPresets/equipPresetNames`；背包帳號共用，其餘角色養成與 A～G 方案隨人物切換；非會員 1×1、鯉民 3×3、鯉長 3×5、鯉市長以上 3×7；Web 只渲染目前可用方案，完整規則由相鄰「＋」按鈕展開，API 仍對越級方案回 403 |
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
- 玩家設定頁的 YouTube 聊天室綁定碼仍是正式流程；另有 Google OAuth 直連測試版，由 `streamAuth.youtubeDirectBindTestDiscordIds` 同時限制 UI capability、state 簽發、OAuth start 與 callback。目前只允許音無恋；授權後以 `channels.list?mine=true` 取得本人 channel ID 並更新同一筆 `streamAccountBindings`，玩家 access token 不落庫，會員 API 查不到時不得清除既有聊天室會員狀態
- OneComme 接收仍是必要 runtime 管線；已移除的是不需要的「玩家查詢直播留言」產品功能，不是整個 listener
- SC 與會員里程碑的各階加成會疊加並保留到本季結束；換季時清除，玩家介面統一標示為「本季保留」
- SC 里程碑的 `claimed` 同時要求伺服器曾發獎且目前累積仍達現行門檻；服務啟動時會自癒門檻調整造成的超前解鎖，精準收回該階 claimed 與 `scms:season:<id>` 永久 Buff，不影響仍達標的較低階獎勵
- 直播資料記錄：`services/stream/streamRecordsService.js`；斗內事件同時保存平台原始金額／幣別與實際採計台幣金額，避免 OneComme 幣別標籤錯誤後無法追查
- 會員同步：`services/stream/membershipTracker.js`
- 斗內、會員、SC、觀看門檻設定：`services/stream/streamEventConfig.js` + MongoDB `serverEventConfig`
- Buff：`services/stream/globalBuffService.js`
- 直播營運控制台：`/studio`（`src/web/public/studio.html`、`studio.js`）；以 `adminLiveRoutes.js` 聚合 OneComme 真實直播狀態、觀看數、活躍留言者、今日斗內、會員、世界王與網頁在線人數，並與遊戲管理後台共用管理 Session。直播規則與轉盤直接在 Studio 編輯；OBS 與場景亦提供依來源實際參數產生網址的內嵌設定器，支援設定、測試預覽、複製與健康檢查，敏感金鑰不在 Studio 持久化。各工作區以 hash 保存；每次開啟或重整 Studio 及主 `/admin` 都要求手動輸入密碼，遊戲本體玩家／怪物資料才跨站
- 舊 `/static/live.html` 僅保留相容入口；管理密碼不再寫入 localStorage

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

- Web ↔ Discord 大廳：`services/chat/`、`playerAppRoutes.js` 的 chat API／SSE。新版遊戲聊天頁會把玩家分享的圖片顯示為可點擊縮圖，點擊後在遊戲內開啟大圖預覽，可用關閉鈕、背景點擊或 Esc 關閉；按下留言「引用」會直接聚焦輸入框，無需再點一次。
- OBS 主聊天室：`src/web/public/chat.html`；由 `/api/chat/overlay-stream` 接收 OneComme 留言，並透過 `/api/chat/viewer-profile` 顯示已綁定玩家的等級、遊戲名稱、稱號與會員位階。每則留言以獨立名牌＋對話窗呈現並維持透明直播背景，視覺採用音無恋專屬的紫藤夜色、月牙與「恋」印記；C／B／A（以及預留的 S／SS）會員位階使用不同外框識別色，只有會員身分、尚未取得位階時使用一般會員色。長名稱、長訊息與圖片會在窄版直播來源中自動換行／縮放，網址加上 `?preview=1` 可顯示不連線的版面預覽。
- 玩家 SPA 介面主題：所有玩家（包含音無恋）統一使用第三版「紫藤冒險據點」；設定頁不再顯示主題切換，舊版「暗黑奇幻」暫停開放，第二版「戰術終端」測試入口移除，既有裝置與網址參數都會強制回到第三版。第三版固定在 9:16 遊戲畫布內，底部為「據點／個人資料／出戰／背包／聊天」五個同級觸控按鈕；五顆維持同尺寸，只有目前分頁向上抬高提示所在位置；任務與其他功能收在右上角全畫布冒險手冊，設定固定在手冊最右下角，據點亦保留任務快速入口。首頁採文字冒險式據點場景：中央固定由「櫃檯小姐」（劇情資料為報到人員）與「教官」（劇情資料為測驗教官）兩位半身 NPC 在每次進入據點時選出一位，停留期間不會自行切換；對話框直接讀取玩家目前裝備的職業徽章實例 `jobExp`，顯示正確熟練度等級與本級場次，另提供可攻略世界王及依等級推薦的普通戰區，立繪若載入失敗會自動改用另一位；櫃檯小姐與教官在手機和桌面都共用貼近場景底部的視覺小說式對話框。公告、任務、故事、商店、拍賣與寵物以加大按鈕排列於場景左右。據點公告先開啟完整公告清單，選取後才進入單篇內容，並可返回列表。世界王不常駐顯示；只有玩家已開啟世界王通知、仍有參戰者且 90 秒內有命中時，才在左上角彈出交戰提示；點擊提示會直接切到世界王分頁並開啟該王的部位出戰畫面。個人能力與完整配裝資訊移至獨立 `/profile` 分頁，第三版不再顯示空狀態橫條與重複的配裝檢閱摘要；背包頁預設先顯示目前裝備，切換後可查看道具；點空裝備欄會直接切到該欄位可用的裝備分類，點已有裝備的欄位只開啟操作視窗，不會切換分類；卸除後留在目前裝備視圖，方便連續卸下多個部位；背包頁移除大型說明橫幅、分類自動換行、配裝方案與裝備欄固定展開、道具彈窗限制在遊戲畫布內，裝備卡依階級顯示外框色，屬性洞燈位於名稱牌上方；工具列以四個緊湊按鈕提供搜尋、排列、篩選與整理，搜尋在小型彈窗輸入，排列使用原生下拉選單；階級、屬性及附魔篩選皆可多選且同組符合任一條件即可顯示，主分類、階級與裝備下層分類的目前選項統一顯示金色選取狀態；從裝備欄切進背包挑裝時，穿戴成功會自動回到目前裝備視圖。拍賣市場提供商品名稱搜尋、階級與七屬性複選篩選；上架道具選擇器同步提供名稱、主分類、裝備子分類、階級複選與七屬性複選，同款裝備或卡片先收合為件數群組，點開後依每件真實 `uuid` 顯示強化、附魔、屬性洞、永久拆除次數與鎖定狀態供精準選擇；寵物頁使用深色高對比面板。Web 全頁與內嵌清單使用獨立 iOS 觸控捲動層；一般與活動關卡詳情採自然高度，不再以固定滿高裁掉出擊鈕。戰鬥層收起後不再顯示可拖曳漂浮窗；從其他頁面按底部「出戰」會恢復目前戰鬥，從戰鬥層或作戰頁再按「出戰」則收起戰鬥並回到目前分頁的選區／選王列表。第三版戰鬥層採第一人稱 HUD：完整戰報預設收在左上角且可展開捲動，正面集中怪物圖片、HP、屬性及控制機制；中央以主要戰鬥鈕搭配有條件才出現的衛星技能鈕，玩家 HP、職業氣條、精靈與結界固定在底部；玩家受擊、低血量、冰凍、格擋與治療分別以右側數字及紅、藍、銀、綠鏡頭光效回饋；共鬥玩家改為左側直向隊友列，點擊仍會顯示真實光環與近十分鐘輸出。新手指引以實際系統按鈕的 `data-onboarding-*` DOM 錨點配合即時 `getBoundingClientRect()` 定位，不再以固定畫面座標猜測按鈕位置。任務頁把職業任務的操作語意改為「獲得職業／已獲得」，職業任務不計入一般待領獎勵紅點；職業分頁固定提示二轉於角色 Lv.35 開放且一轉徽章需練滿 Lv.20。經典模式底層程式暫時保留以便未來恢復，但目前沒有玩家入口。
- 據點 NPC 對話會依語意強調重要資訊：可攻略世界王與王名使用金色警示、等級與經驗使用成長綠、職業熟練與轉職使用紫色、獎勵與活動解鎖使用粉色；只標記關鍵詞，不把整段對話改色。職業熟練提示直接使用身上職業徽章實例的 `badgeProgress`，顯示的等級與本級場次須和裝備詳情一致，不使用角色舊有的全域 JOB 欄位。
- 玩家 SPA 字體大小：設定頁的「小／中／大」會套用至一般頁面、第三版主題與戰鬥 HUD 的系統文字；小字維持原始尺寸，中字加大 2px（預設），大字加大 4px。此設定只改文字，不縮放 9:16 畫布、上下導覽、圖片或操作物件尺寸。
- 新版介面的玩家可見頁面不再顯示「測試版」、「NEW UI PREVIEW」或「封閉測試」標籤；目前所有帳號只使用第三版「紫藤冒險據點」，不提供其他主題切換。
- 後台全服強制重整會跨服務重啟保留目標前端 build 24 小時：前景玩家透過 SSE 立即重整；背景、鎖屏或當下斷線的舊版頁面，回到前景重新連線時會補收重整命令；已載入目標 build 的頁面不會再次重整。若保留期間又部署了更新的 build，後端會自動清除舊目標，前端也會以 session target 去重，避免形成無限重整循環。
- 背包複選篩選：階級複選維持符合任一階級即可；屬性複選改為必須同時持有所選全部屬性，例如選水與火時只有同時具有水、火屬性洞的裝備會顯示；附魔最多選 3 個詞條，裝備必須同時具有全部所選詞條，且每條都達到各自設定的最低數值。
- 背包與身上裝備格的強化 `+N` 角標固定內縮在右上安全區並位於裝備圖片上層，不使用會被卡片裁切的負座標。
- 討伐關卡詳情在手機上只使用頁面外層縱向捲動，近十分鐘傷害排行不建立第二個捲動層、也不攔截觸控；怪物預覽縮為 112px，保留更多高度給排行與出擊按鈕。
- 第三版戰鬥共鬥列：左側直向列包含自己，以窄版「共鬥」外框統一包住各玩家的圓形頭像與近十分鐘輸出，清楚表達組隊區概念但不繪製貫穿戰場的長底框；隊伍增加時依內容往下新增節點、超過安全高度時在框內捲動。共鬥列是獨立絕對定位覆蓋層，無論玩家數量、聊天泡泡或詳情開合，都不會推動怪物、中央操作盤、自身 HP／氣條或底部導覽。最近在網頁大廳或 Discord 城鎮頻道發言的玩家會顯示訊息前 6 字（超過才加省略號）的短摘要泡泡；泡泡可伸出共鬥外框且不被捲動框裁切，用來提示玩家前往聊天頁查看完整內容。領域快捷表情同樣從發送者頭像旁彈出，並與聊天泡泡一起渲染在共鬥捲動裁切層外，捲動時仍跟隨對應玩家且不會被外框切掉；展開的完整戰報與共鬥列位於同一層疊容器且固定高於共鬥框，左上收合按鈕與 COMBO、左側共鬥列、右側快捷表情各有獨立安全區，不互相覆蓋，也不壓住底部玩家 HUD。
- 第三版戰鬥操作盤與受擊回饋：戰場會先保留固定尺寸的操作盤區域，單一攻擊、三種元素或未來最多五個快捷鍵都只能在該區域內排列與交換，技能數量和動畫不得推動自身 HUD。中央目前採用的主攻擊會以大圓顯示，該職業其餘可用姿態／技能依數量沿下半圓排列且不顯示空位；第一人稱模式點姿態小圓會立刻以該姿態出戰，同時用交換動畫把新姿態移入中央、原姿態縮回外圈，不需要再按一次中央。元素師以伺服器預設的嵐暴置中，炎圈與凍霜分列左右，送出戰鬥時仍由伺服器驗證姿態。自身 HP、BUFF 與職業氣條整組固定下移至底部導覽上方，快捷表情固定在 HUD 上方避免重疊；下方不常駐堆疊額外說明，保留給後續補品數量、自動使用門檻與回合 CD 等戰鬥快捷狀態。玩家受傷只播放不改變座標的光效，場景、玩家 HUD、頂欄、戰報、操作盤和底部導覽都保持固定；玩家受擊不再疊加兩層紅色全畫面閃光，改用低亮度紅色邊緣脈衝，格擋改為霧藍邊緣光，暴擊、處決與閃電的全畫面亮度同步降低；玩家回血與吸血只讓自身 HP 條播放一次綠色流光，不再讓整個戰場閃綠光，回血與傷害數字仍照常顯示；臨時狀態列預留固定高度，出現或消失不得重新排版。
- 第三版戰鬥資訊層：怪物圖片以場景化邊緣與地面陰影融入地圖，依真實事件播放受擊、詠唱、暈眩與勝利退場；怪物名牌與自身 HUD 以圖示列濃縮顯示暈眩、冰封、聖域、海嘯、破綻、結界及隊友光環等已確認狀態。完整戰報保留在左上角並可收合；戰場中央不重複顯示逐事件短字幕，也不保留額外結算小窗。戰鬥核心會在結果回傳本場實際採用的攻擊屬性、濃度、相剋關係與倍率，操作盤顯示該真值；長按任一技能會開啟伺服器職業設定產生的說明。神射手的掩護射擊、神速反擊與震盪射擊直接由伺服器戰報事件驅動不同箭道、準星與來源提示；兵聖的五種計策同樣讀取伺服器事件，在戰場右上顯示不推動 HUD 的計策卡與對應場景色光，前端不重算傷害或自行決定計策。每招回合冷卻與補品快捷欄皆已預留結構化欄位，但只有伺服器提供真實資料時才渲染，不建立假冷卻或假道具數量。共鬥列的新成員由左側滑入，實際提供本場光環的隊友會以脈衝連線標示。
- 公告：`services/announcement/`
- 玩家即時事件：`services/realtime/`、`webPresence`
- 直播 overlay：`streamOverlayRoutes.js`、`chatOverlayHub.js`

## 管理、登入與安全

- Discord OAuth／JWT：`playerAppRoutes.js`、`api/middleware/requireAuth.js`；登入頁透過 `/api/auth/discord/login` 使用後端 runtime OAuth 設定，不依賴前端建置時注入 Client ID，並提供小型「切換 DC 帳號登入」入口
- 管理權限：`services/admin/accessControlService.js`
- Web ban：`services/access/webBanStore.js`
- 維護模式：`services/access/maintenanceStore.js`
- 遊戲營運後台：`src/web/public/admin.html` 與 `admin.*.js`；功能依營運、玩家帳務、遊戲內容、任務劇情、戰鬥活動、商店交易與系統紀錄分類
- 直播營運後台：`src/web/public/studio.html` 與 `studio.*`；兩個後台可互相深連結並共用 `/api/admin/session` 的 HttpOnly Session
- 管理 API 相容層：`src/api/adminSession.js`；Session 驗證後橋接既有 `/admin/*` Bearer guard，舊 API 呼叫不需同時重寫
- API 防護：CORS 白名單、全站 `/api` rate limit、SSE 例外、正式環境弱密鑰 fail-fast
- 審計：`adminActionLogs`；所有 `/admin` 的 POST／PUT／PATCH／DELETE 由共用 middleware 記錄路徑、結果、耗時與欄位名稱，原本已有詳細玩家發放紀錄的 API 不重複寫入

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
- 全職業貢獻：`npm run test:job-contribution`（含正式 MongoDB 24 職業只讀覆蓋稽核）
- 職業／任務：`npm run test:job-transfer`、`npm run test:anchor-quest-metrics`、`npm run test:quest-progress-batch`
- 直播通知：`npm run test:stream-notifications`
- DB 快照：`npm run status:update`
