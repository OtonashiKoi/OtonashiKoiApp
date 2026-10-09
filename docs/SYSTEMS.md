# 系統索引 SYSTEMS

> 狀態：現行程式索引。最後核對：2026-08-16。
>
> 執行事實以 `src/**` 與目前 MongoDB 為準。資料數量與 DB 開關請先執行 `npm run status:update`，再看 [CURRENT_GAME_STATUS.md](CURRENT_GAME_STATUS.md)。

## 核心入口

合成工房：`src/services/crafting/craftingService.js`、`src/api/routes/playerCraftingRoutes.js` 與 Mongo `craftingRecipes`／`craftingTransactions`／`craftingOperations`。2026-10-04 公開10張5換1寶石／屬性石配方；共用登入維護門禁、請求防重與持久化恢復仍適用，詳見 [CRAFTING](CRAFTING.md)。

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
- 共用機制與擊殺結算：`src/services/battle/zoneBattleService.js`；貨幣原子性、runtime 所有權及發布回復的實作範圍見 [SYSTEM_HARDENING](SYSTEM_HARDENING.md)。
- Discord：`src/bot/handlers/monsterZoneHandlers.js`、`src/bot/monsterZoneView.js`
- Web API：`src/api/routes/playerAppRoutes.js` 的 `/api/combat/*`
- Web 一般怪結算以 `activeMonsterSeq + currentHp` 作 MongoDB 條件式更新；同怪並發扣血會重讀後重試，已死亡、轉場或已換怪的舊戰鬥結果直接丟棄，不能把上一隻怪的剩餘 HP 寫到下一隻。區域快照與開戰入口另將持久 HP 限制在目前怪物模板 `0..maxHp`，並自動修復既有超上限狀態
- 區域怪物狀態以 `monsters` collection 的 `_id: monsterState:<zone>` 為 canonical；擊殺收付鎖與一般讀取使用同一份文件。`monsterState` collection 僅保留相容鏡像，兩者暫時不同步時不得用舊鏡像覆蓋或阻擋 canonical 的換怪結算
- 玩家 SPA 的一般討伐換怪不等待下一場 API 回應才更新畫面：`BattleLayer` 先讀取上一場回應已寫入 `zonesQueryKey` 快取的下一隻怪，清掉上一場結算畫面並立即顯示新怪，背景伺服器權威結算回來後再以完整 `BattleData` 接續播放；請求失敗會恢復可操作狀態。全站 API 寫入提示不追蹤 `/api/combat/quick-battle` 與 `/api/me/solo-boss/battle`；戰鬥仍由 `inflightRef`、`battleStarting` 與排隊狀態防止重複送出，其他寫入操作仍使用全站提示
- Web 死亡冷卻由 `src/shared/battleTiming.js` 統一計算為「本場前端播放時間＋30 秒死亡懲罰」；戰鬥層只在播放完成、玩家真正看到敗北時顯示倒數，因此當下仍為完整 30 秒。Discord 則在 `displaySettledBattleResult()` 播完逐回合戰報後才呼叫 `recordDeathCooldown()`，兩端語意一致
- 後台：`adminMonsterRoutes.js`、`adminCombatCalculatorRoutes.js`
- Web 舊夏日場景 `uploads/zones/event_1.webp` 保留；本季 `event_1`／`event_boss` 已暫停，不顯示可出戰關卡。
- 資料：`monsters`、`monsterState`、`battleConfig`、`effectDefinitions`

### 世界王與 KDA

- 共用服務：`src/services/worldBoss/worldBossService.js`
- 實例組裝：`createServiceContext.js`
- 目前六個 boss key（新增 `steel_crown` 鎧冕王・赫鋼）：`default`（大史王）、`dragon_king`（古龍王）、`hellfang_king`（地獄狼牙王）、`island_turtle`（島島龜王，本季暫停）、`northwind_hutao`（北風雀神・胡桃，10/8–10/15限時公開）
- 楓紅漸漸停用舊夏日內容：`zones.js` 的 `event_1`／`event_boss` 不列入公開或管理員戰鬥入口，直接出戰與 Discord 舊事件按鈕同樣受阻；巡檢、重生與換怪跳過暫停區域。MongoDB 的 8 隻活動怪、龜王 `worldBossConfig.value.enabled`、龜王相關任務與 2 筆夏日收藏商品均關閉。舊道具、卡片登錄、稱號與世界王狀態保留；`cardDex.js` 不將暫停區的 8 張卡列入本季全集要求。胡桃依 `hutaoActivity.js` 限時公開，常態世界王維持原設定。
- 階段技能由各王 `worldBossConfig.phaseConfig` 的開關獨立控制；三階段只代表血量區間與階段倍率，不會自動授予雷擊術。相容尚未寫入 `lightningEnabled` 的既有資料時，僅大史王第二／第三階段保留原本雷擊，其他四王預設關閉
- 常態前置鏈：大史王 → 古龍王 → 地獄狼牙王；島島龜王沒有前置王。胡桃使用獨立 `event_boss_hutao_preview` 區域與世界王狀態，目前Lv.40起可由出戰→活動進入，10/15 16:25:13（台灣時間）停止新入場；仍不列入 Web／Discord 怪物圖鑑；不覆蓋或移除 `event_boss` 島島龜王，供未來活動王輪替／混流
- 胡桃內容包含 13 種 S 階限定武器、8 件 A 階「北風套裝・大四喜」與胡桃王卡；武器共通被動「風向輪轉」跨戰鬥保存步進，依序提供東風命中、南風最終傷害、西風爆擊傷害、北風爆擊率，完整套裝則每個場風維持 3 回合。胡桃本身每60秒輪替場風、命中時12%四段各45%ATK連擊；舊70%／40%答題已退出流程。王卡每20秒立直（開場首次），50%自摸使共鬥者AGI+15持續15秒，持卡者四段各30%ATK；未自摸全體LUK+5持續15秒、持卡者扣當前HP10%。胡桃沿用一般即時共鬥，擊殺後30分鐘重生；元素師同場即時切招，冰凍／暈眩共享計量300觸發20秒控制、120秒免疫；詳見 `EVENT_WORLD_BOSSES.md`
- 單人王：`src/api/routes/soloBossRoutes.js`；`accountSoloBoss` 位於帳號頂層，三個人物共用每日擊殺上限與部位進度；舊人物快照會在首次讀取時合併
- KDA：`src/services/kda/kdaService.js`；戰內歸戶在 `combatLoop.js` 的 `assistLedger`，共用效果分類與防禦收益反推在 `src/shared/supportContribution.js`。賽季總計仍保留，新增 `jobStats.<jobId>` 按每場出戰職業記錄 K／D／場次，外部光環與區域窗口的 A 也按提供能力時的職業記錄；舊總計因沒有歷史職業快照不猜測回填
- 助攻口徑：聖靈師／治療師的隊伍增傷與有效治療都計入；兵聖／軍師的 Boss 增傷與怪物破防分開換算；結界師／聖域師按實際擋傷，吟遊詩人／詩人 AGI 光環按傷害當量；神射手掩護箭作為提供者直接 K，不重複列 A 或算給受支援者，部位殘血截斷時所有直傷來源等比例縮放。自己的光環不可自益，EXP／金幣光環不算戰鬥助攻
- 世界王寶箱只依本王戰鬥貢獻 `傷害 + 0.7 × 助攻當量` 排名前 6 名；入場費與累積花費不參與排名。只有本輪實際進入戰鬥的玩家具有排名資格，世界王擊殺或超時換輪時會清除跨場光環，避免上一輪提供者以 0 傷害助攻進入新一輪榜單；寶箱數量仍依本王有效參與人數及最終名次決定。結算公告優先解析 Discord 顯示名，解析不到只顯示「某位勇者」，不顯示完整或部分 Discord ID
- 世界王怪物資料必須提供穩定的 `seq`；相容舊活動王缺少 `seq` 的狀態時，擊殺權會把缺值統一視為 `null`，不可因 `Number(undefined)` 變成 `NaN` 而漏結算。若四部位全破後結算遭重啟或例外中斷，背景檢查會保留本輪 `damageMap`／`participants` 並重跑正常擊殺結算；失敗時維持全破狀態等待下次重試，不得直接補滿血或清除寶箱資格
- 世界王暈眩條：`src/shared/dwarfStunGauge.js`；巨神震擊窗口內開始的戰鬥會封鎖世界王整場的普攻、怪物卡技能與階段技能（包含雷擊術）；玩家自傷不屬於怪物傷害。矮人與元素控制條會原子保存本輪所有敲條者，窗口被玩家實際使用時，以受益玩家有效輸出的 10% 作助攻池並按敲條量分帳；聖域條同樣保存所有累積者，按窗口實際擋傷與有效治療分帳。Discord、Web 與單人王入口共用同一歸戶規則
- 元素師炎圈對其餘存活部位的鏡射傷害在 Discord、Web 與單人王使用同一規則，會同步扣除各部位 HP 並計入元素師當場職業的 K
- Web 戰鬥 UI：獨立顯示世界王總血量／機制狀態，部位名牌與傷害數字不覆蓋機制面板；世界王詳情的排行榜預設顯示純傷害，可切換成與寶箱相同公式的貢獻排行，貢獻列同時顯示傷害與助攻拆分；世界王與單人王的亮色選怪卡使用亮底專用深色文字，名稱、屬性、入場費、冷卻與部位標籤維持高對比；世界王選怪卡、進場前部位頁與尚未攻擊的龜王戰鬥畫面都透過 `/api/worldboss/status` 顯示龜王總血、潮汐、安全、詠唱、海嘯、破綻與逐秒倒數，海嘯中出擊鈕改為紅色「進場即死」警告但仍可點擊；`battleStore.buildTimeline()` 保留完整戰報並把每一條非回合內容轉為語意動畫事件，`BattleLayer` 依回合分組，主要攻擊、技能、暴擊、怪物反擊、治療、狀態、格擋與閃避全部照順序播放，不做重點刪減；連擊與怪物多段攻擊的每一段也完整保留；`weaponPresentation` 以後端回傳的 `weaponType` 將所有主手武器分成單／雙手劍、匕首、單／雙手錘、單／雙手斧、單／雙手法杖、弓、骰子與空手演出，`WeaponAttackFx` 負責斬擊、突刺、砸擊、劈砍、魔法、投射及屬性／暴擊演出，持續傷害、反傷與隊友支援不冒用自身武器動畫；同一次玩家攻擊只保留一個主要武器演出，不再疊加頭像環、爆裂底圖及全畫面閃光，合併多段攻擊只有第一段播放整套動畫；元件移除全層混色與大型 drop-shadow，錘擊碎片及常駐同時演出數量亦縮減；設定頁的戰鬥特效開關以 `okoi-battle-visuals` 保存於目前裝置，關閉後停止武器、骰子、職業提示與畫面光效，但 HP、傷害數字、骰點文字及完整戰報仍保留；戰場中央不再另外渲染逐事件短字幕；一般回合固定使用後端依 AGI 回傳的 `tickMs` 時槽並按事件數縮短間隔，骰子武器則以 `combatLoop.diceEvents` 的後端結算骰面保留 620ms 落地時間（重骰 900ms），兩顆傷害骰旋轉彈跳後才播放傷害，賭神命運值滿時另落下一顆金色命運骰；第三版戰鬥層只在觸控裝置以手機 `VisualViewport` 的實際可見寬高縮放完整 390×693.33 設計畫布，頂部玩家 HUD、龜王機制、怪物、操作盤、自身 HP 與底部主導覽共用同一倍率；桌機沿用全站 9:16 視窗框與中央戰場縮放，不會再被手機倍率二次縮小；內部元件不因高度斷點切換位置或被個別裁切；戰報預設展開、可收合成小列，選擇以瀏覽器 localStorage 保存
- 島島龜王的 Web 戰鬥背景由 `uploads/zones/event_boss.webp` 提供，與夏日活動區維持同一套海島遺跡場景
- 島島龜王沿用四部位 key 以相容世界王引擎，但顯示名稱固定為 `head=龜首`、`body=島背`、`wings=左鰭`、`legs=右鰭`；古龍王的 `wings` 才顯示龍翼
- 島島龜王海嘯由 `src/shared/turtleTide.js` 統一驅動：只在本輪總血首次降到 70%／40% 時各強制一次，不做時間週期觸發；詠唱 3 分鐘期間全部位可攻擊但全身承傷僅 1%，冰凍與暈眩累積 ×2；巨神震擊命中時會完全中斷並隱藏詠唱條，暈眩結束後從 0% 重跑完整詠唱且不開啟破綻；詠唱狀態會用獨立原子暈眩文件自動校正，避免多人同時結算時被舊 `monsterState` 蓋回；區域冰封仍會打斷詠唱並開啟 30 秒 ×1.3 破綻；詠唱完成時仍在戰鬥中的玩家會在對應回合被真海嘯命中，海嘯 3 分鐘內新進場者則開場即死；海嘯結束後有 30 秒 ×1.3 破綻
- 資料：`worldBossConfig`、`worldBossState`、`worldBossChestGrants`、`kdaSeasonStats`、`worldBossStunGauge`

### 爬塔

舊爬塔暫停；新版 Web 組隊採下列獨立入口。

- 新版網頁組隊：2～5 人、恰好一坦、全員準備；Lv.30／30 樓、Lv.40／50 樓自動連戰。HP ×5，傷害一般 ×1.5／挑戰 ×2；個人 EXP 與掉率 ×1.5。規則與流程見 [PARTY_TOWER](PARTY_TOWER.md)。房間持久化於 `partyTowerRooms`，服務入口為 `partyTowerRoomsV2.js`，API 為 `/api/tower/party/*`。登入維護門禁仍適用。
- 下列是保留的舊 Discord／單人 71 層功能：

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
| 寵物 | `services/pet/petService.js`、`bot/handlers/petHandlers.js` | `progress.pets`、`progress.petDex`；採集池排除停用、私測、標記 `limitedEvent` 或 `noPetGather` 的裝備、卡片與特殊槽位。既有海灘 A 裝只有 `dropTheme: event_beach`，未標記禁止採集，仍可由符合階級的寵物撿回；取得時保留套裝歸屬。 |
| 麻將 | `services/mahjong/`、`api/routes/mahjongRoutes.js` | runtime queue state |
| 戀雀直播預測 | `services/mahjongPrediction/`、`api/routes/mahjongPredictionRoutes.js`、Live Studio、獨立 SPA 畫面 `/mahjong-live`、`mahjong-prediction-overlay.html` | 專屬 Discord OAuth token，不建立 RPG 角色；`mahjongPredictionWallets`、`mahjongPredictionTransactions`、`mahjongPredictionMarkets`、`mahjongPredictionBets`、`mahjongPredictionState` 與 RPG 完全分離 |
| 主線故事／據點訪客 | `services/story/storyService.js`、`api/routes/storyRoutes.js` | `storyChapters`、`storyNpcs`、`progress.storyProgress`；登入玩家可由 `/api/story/hub-npcs` 取得有立繪且排除音無恋的據點訪客清單 |
| 錨點圖鑑／試煉 | `shared/anchorAcquisition.js`、`shared/anchorQuestRules.js`、`api/routes/playerCollectionRoutes.js`、`services/weeklyQuest/weeklyQuestService.js` | 九件錨點皆有取得提示；聖人試煉不綁抖內，命運之輪為每輪有下注者不論輸贏 3% 且每人限一次 |

## 道具、經濟與成長

| 系統 | 程式 | 資料／備註 |
| --- | --- | --- |
| 背包與換裝 | `services/item/itemService.js`、`services/shop/shopService.js`、`playerAppRoutes.js` | `items`、`progress.inventory/equipment`；支援使用、丟棄、出售、鎖定、批次操作與伺服器權威的一鍵最大 ATK 配裝；自動配裝依目前職業限制武器種類，並保留稱號、職業徽章、卡片與錨點。強化石、藥水與七種屬性石依 `itemId` 合併堆疊；收藏品預設依道具庫排序值／發布時間顯示版本先後；Web 防裝篩選把頭部上、中、下三個槽位分開顯示 |
| 遊戲素材預先下載 | `services/assets/gameAssetManifest.js`、`api/routes/playerAssetRoutes.js`；SPA `gameDownloads.ts`、`GameDownloadPanel.tsx` | `GET /api/me/assets/manifest` 合併正式靜態圖片／BGM／音效與目前 MongoDB 素材，依 Cloudflare Static Assets 發布表提供雲端下載網址；排除收藏圖片及未開放職業大師。首次登入下載至裝置，設定只補缺檔／新版本，換頁不再等待图片；實際遊戲仍需連線。完整規則見 `SCENIC_UI.md` |
| 多人物與裝備方案 | `services/character/characterService.js`、`shared/membershipEntitlements.js`、`services/shop/shopService.js`、`api/routes/playerPresetRoutes.js` | `progress.activeCharacterSlot/characterSlots/activePreset/equipPresets/equipPresetNames`；背包帳號共用，其餘角色養成與 A～G 方案隨人物切換；非會員 1×1、鯉民 3×3、鯉長 3×5、鯉市長以上 3×7；Web 只渲染目前可用方案，完整規則由相鄰「＋」按鈕開啟說明視窗，API 仍對越級方案回 403 |
| 背包容量 | `services/backpack/backpackService.js` | 主要戰鬥入口會在背包滿時阻擋 |
| 強化與屬性洞 | `services/enhance/`、`api/routes/playerAppRoutes.js`、`api/routes/playerForgeRoutes.js` | 寶石強化；D1/C2/B3/A4/S5 屬性洞；屬性鑲嵌與破壞拆除。拆除次數永久保存在 `progress.inventory/equipment[].elementRemovalCount`，最多成功 3 次 |
| 附魔 | `services/enchant/enchantService.js`、`playerEnchantRoutes.js`、`adminEnchantRoutes.js` | 設定快取於啟動初始化；Web 重骰在送出 API 前有消耗確認 |
| 商店 | `services/shop/shopService.js` | `shopItems`、`shopClaims`；五種組隊回復／復活藥水不限持有量，單筆仍為 1～999 個；其他有限持有量商品依 `stackCount` 累加實際數量。副本出發前另驗證每人最多攜帶 10 瓶、其中復活藥最多 2 瓶，途中不能補帶 |
| 拍賣 | `services/auction/auctionService.js` | auction repository；Web 與 Discord 的上架選擇器皆可分別篩選頭部上、中、下三個槽位 |
| 錢包／發獎 | `walletService.js`、`rewardService.js`、`transactionService.js` | `wallets`、`transactions` |
| 周邊商城 | `services/merch/merchService.js`、`api/routes/merchRoutes.js` | `merchItems`、`merchOrders`、綠界付款 |
| 等級 | `services/progress/progressService.js`、`shared/progression.js` | Lv.50；溢出 EXP 轉金幣 |
| 打卡 | `services/checkin/checkinService.js`、`config.streamMembership.bindYoutubeUrl`、`api/routes/playerAppRoutes.js`、`bot/playerPanel.js` | `checkins`；Web 打卡教學與 Discord 打卡狀態／綁定提示共用同一個 YouTube 打卡直播網址 |
| 邀請碼 | `services/invite/inviteService.js` | `inviteCodes` |
| 會員 tier | `services/playerTier/playerTierService.js` | `playerTiers` 與 Discord role |

Web 背包道具詳情的底部右側固定為「關閉」；「丟棄」收在需展開的其他操作中，點選後仍會顯示永久丟棄確認視窗，避免把關閉誤按成丟棄。

背包差異存檔保留讀取時原始 UUID 基準；強化石、七種屬性石與可合併藥水依 `itemId` 總量計算本次增減，再套用到最新背包。同款未鎖定屬性石在讀取時合併顯示，下一次背包變動存檔時寫入合併堆疊；不同屬性及鎖定件分開保留。舊堆疊合併不算新增獎勵，並行掉落保留，並行消耗不會被舊快照補回；數量衝突拒絕寫入。同一物件重複存檔會刷新基準，存檔成功但回應中斷的重試透過同筆寫入的 `inventorySaveReceipts` 防止重扣（保留最近128筆，普通 progress 寫入不可覆蓋）。實作：`shared/inventoryStacking.js`、`adapters/mongo/progressInventoryStacks.js`；回歸：`scripts/test-enhance-stacks.js`、`scripts/test-element-stone-stacks.js`。

## 任務與職業

### 任務

- 本季七稱號任務由 `autumnTitleRules.js` 與 `autumnTitleService.js` 執行；進度在 `progress.autumnTitleProgress.slots` 依人物分開，領取與背包發獎同次 CAS 寫入。代表稱號装備後 EXP +3%、金幣 +2%；戰鬥沿用共用效果結算，兩種掛機領取亦適用。詳見 [秋季稱號與任務](AUTUMN_TITLES.md)。

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
- 吸血左之戒 C／B／A 階為 5%／10%／15%；普通攻擊、連擊及固定多段每回合合計結算一次，擊殺回合也結算。持續戰鬥保留核心已載入的裝備被動，回血與戰報、一般區 HP 儲存及 HUD 事件一致。驗證：`scripts/test-lifesteal-ring.js`
- 當回合治療在當回合開始／觸發點結算並寫戰報，不以開場效果說明冒充治療紀錄

### 一轉與二轉

- 單一來源：`src/shared/jobAdvancement.js`
- 現有 11 個一轉、13 條二轉分支；每個一轉至少 1 條可用
- 目前 2 條分支鎖定：劍鬼、盜靈；其餘 11 條可由任務／故事流程開放
- 徽章熟練度：`src/shared/jobBadgeLevel.js`、`services/job/jobBadgeService.js`
- 二轉費用、條件、同職分支互斥與 `seasonLocked` 都由 `jobAdvancement.js`／`weeklyQuestService.js` 判定
- 任務二轉扣款編號包含帳號、賽季與任務；換季後重新付本季費用，舊季台帳不會擋住轉職或抵掉新費用。已扣款但徽章保存中斷時，重試沿用原付款，只補完徽章與完成旗標；取得本季徽章之前的舊編號交易不會被當作本次付款。
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
- 直播資料記錄：`services/stream/streamRecordsService.js`、`services/stream/donationSummary.js`；斗內事件同時保存平台原始金額／幣別與實際採計台幣金額，避免 OneComme 幣別標籤錯誤後無法追查。後台營收總算以 MongoDB `maintenanceState.openAt`／`activateAt` 的季度起訖為主，分列 YouTube、綠界、其他來源與全部合計；台灣月份只作輔助查帳，不改變季度總算
- 綠界直播主收款 ReturnURL 由 `services/payment/ecpayDonationService.js` 收單，`ecpayCrypto.verifyCheckMac()` 優先驗證新版 `Uri.EscapeDataString`，並在 2026-09-01 正式切換過渡期相容舊版 `HttpUtility.UrlEncode`；每筆通知保存 `macVariant` 供監控。周邊商城 AioCheckOut 是另一產品，繼續使用既有編碼規格，不跟著直播主收款全域切換
- 會員同步：`services/stream/membershipTracker.js`
- 頻道主重新授權：`api/routes/adminCreatorAuthRoutes.js` 的授權 `state` 僅含用途、平台與一次性亂數；伺服器只在記憶體保留十分鐘內待處理亂數，回呼驗證後立即失效，管理密碼不放入 Google/Twitch 授權網址。
- 斗內、會員、SC、觀看門檻設定：`services/stream/streamEventConfig.js` + MongoDB `serverEventConfig`
- Buff：`services/stream/globalBuffService.js`
- 直播營運控制台：`/studio`（`src/web/public/studio.html`、`studio.js`）；以 `adminLiveRoutes.js` 聚合 OneComme 真實直播狀態、觀看數、活躍留言者、今日斗內、會員、世界王與網頁在線人數，並與遊戲管理後台共用管理 Session。直播規則與轉盤直接在 Studio 編輯；OBS 與場景亦提供依來源實際參數產生網址的內嵌設定器，支援設定、測試預覽、複製與健康檢查，敏感金鑰不在 Studio 持久化。各工作區以 hash 保存；每次開啟或重整 Studio 及主 `/admin` 都要求手動輸入密碼，遊戲本體玩家／怪物資料才跨站
- 戀雀直播預測：Live Studio 的「戀雀預測」工作區手動建立「本局能否和牌」或「最終和牌級別」盤口，可提前封盤、依客觀選項結算，或作廢並原子退還全部投注。玩家從獨立 `/mahjong-live` 介面以專屬 Discord OAuth token 登入，完成後仍停留在戀雀頁，不載入 RPG 主框架、不建立角色、不要求玩家身分組，也不讀寫金幣／鑽石。首次啟用 10,000 張、每日可領 1,000 張、單注 100～5,000 張；派彩為中獎者取回本金並按比例分配落選池 90%，其餘回收；OBS 使用 `/static/mahjong-prediction-overlay.html`
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

OBS 內部聊天室的等級與稱號仍依直播帳號綁定的玩家資料顯示；名稱優先取即時 Discord 公會暱稱、全域名稱、帳號名稱。Discord 名稱無法取得或觀眾未綁定時，顯示該則留言在直播聊天室的原始名稱，不使用遊戲存檔暱稱代替。

- Web ↔ Discord 大廳：`services/chat/`、`playerAppRoutes.js` 的 chat API／SSE。新版遊戲聊天頁會把玩家分享的圖片顯示為可點擊縮圖，點擊後在遊戲內開啟大圖預覽，可用關閉鈕、背景點擊或 Esc 關閉；按下留言「引用」會直接聚焦輸入框，無需再點一次。
- OBS 主聊天室：`src/web/public/chat.html`；由 `/api/chat/overlay-stream` 接收 OneComme 留言，並透過 `/api/chat/viewer-profile` 顯示已綁定玩家的等級、Discord 名稱、稱號與會員位階；Discord 名稱無法取得時使用直播聊天室名稱。每則留言以獨立名牌＋對話窗呈現並維持透明直播背景，視覺由 `chat-ro.css` 提供 RO 風格的銀藍標題列、立體細邊框與白底對話窗；C／B／A（以及預留的 S／SS）會員位階使用不同外框識別色，只有會員身分、尚未取得位階時使用一般會員色。長名稱、長訊息與圖片會在窄版直播來源中自動換行／縮放，網址加上 `?preview=1` 可顯示不連線的版面預覽。
- Discord 防洗版：`src/bot/client.js` 的 `checkSpam()` 會攔截非管理員濫用 `@everyone`／`@here`，並偵測不限帳號、文字或附件類型的短時間跨頻道洗版；預設 30 秒內跨 4 個文字頻道即刪除該波訊息，依累犯級距在管理頻道留下警告及禁言紀錄。一般玩家身分不豁免此規則，只有管理員豁免；門檻可由 `CROSS_CHANNEL_BURST_LIMIT` 與 `CROSS_CHANNEL_BURST_WINDOW_MS` 調整。
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
- 第三版戰鬥資訊層：怪物圖片以場景化邊緣與地面陰影融入地圖，依真實事件播放受擊、詠唱、暈眩與勝利退場；怪物血量歸零時立即啟動約 0.65 秒的光粒分解，死亡退場階段結算並批次入袋；前進 1.5 秒後直接顯示預先準備的下一隻，不等待最後戰報封包；圖片優先使用本場快照，進場競速缺圖時會由世界王或區域輪詢補回，短暫載入失敗亦會自動重試，島島龜王另有同站靜態圖備援，不會因一次失敗永久變成通用鬼面。怪物名牌與自身 HUD 以圖示列濃縮顯示暈眩、冰封、聖域、海嘯、破綻、結界及隊友光環等已確認狀態。 敵方狀態列的技能／增益圖示可點擊，於遊戲畫布內開啟技能說明小窗；內容使用本場戰報提供的描述，未提供時明示缺少詳細說明，切換下一場會關閉。戰報預設顯示關鍵過程與一次結算，可收合或切換完整戰報；完整原始行不因精簡顯示而刪除。戰場中央不重複顯示逐事件短字幕，也不保留額外結算小窗。開場說明、光環與無傷害技能宣告直接寫入完整戰報，不分走回合動畫時間；增益／減益以對應角色狀態列圖示提示，並依戰報所載回合數顯示。有實際傷害或落空的攻擊技能才把技能名貼在出手角色身上，與攻擊動作及受擊反應同時演出；只有真實受擊事件才播放受擊光圈與鏡頭反應。戰鬥核心會在結果回傳本場實際採用的攻擊屬性、濃度、相剋關係與倍率，操作盤顯示該真值；長按任一技能會開啟伺服器職業設定產生的說明。神射手的掩護射擊、神速反擊與震盪射擊直接由伺服器戰報事件驅動不同箭道、準星與來源提示；兵聖的五種計策同樣讀取伺服器事件，在戰場右上顯示不推動 HUD 的計策卡與對應場景色光，前端不重算傷害或自行決定計策。每招回合冷卻與補品快捷欄皆已預留結構化欄位，但只有伺服器提供真實資料時才渲染，不建立假冷卻或假道具數量。共鬥列的新成員由左側滑入，實際提供本場光環的隊友會以脈衝連線標示。
- 公告：`services/announcement/`
- 玩家即時事件：`services/realtime/`、`webPresence`
- 直播 overlay：`streamOverlayRoutes.js`、`chatOverlayHub.js`

## 管理、登入與安全

- Discord OAuth／JWT：`playerAppRoutes.js`、`api/middleware/requireAuth.js`；登入頁透過 `/api/auth/discord/login` 使用後端 runtime OAuth 設定，不依賴前端建置時注入 Client ID，並提供小型「切換 DC 帳號登入」入口
- Web 季度入口：SPA `src/routes/login.tsx` 使用已確認的「楓紅漸漸」封面與季名，手機裁切保留人物、季名以深色標籤顯示；`index.html` 的標題、分享說明與 Open Graph／Twitter 圖片同步秋季封面。入口仍依 `/api/maintenance` 控制玩家登入與管理員測試，封面更新不改動開季排程。舊夏日活動與音樂沿用決策另行追蹤。
- 管理權限：`services/admin/accessControlService.js`
- Web ban：`services/access/webBanStore.js`
- 維護模式：`services/access/maintenanceStore.js`
- 每次角色升等耗時：`services/progress/progressService.js` 在經驗值 CAS 存檔成功時，將每個達成等級的 `fromLevel`、`toLevel`、`startedAt`、`reachedAt`、`elapsedMs`、經驗來源寫入該角色的 `progress.levelUpHistory`。`elapsedMs` 是兩個時間點之間的實際經過時間，包含離線時間；舊角色若無起點，首次升等的耗時記為 `null`，不推算。切換人物時資料隨角色快照移動，換季備份保留舊紀錄，新季重置為空。
- 楓紅漸漸季度入口（2026-10-02 管理員要求暫停開放）：`maintenanceState.enabled=true`、`strict=false`，一般玩家登入、即時串流及遊戲操作關閉，白名單管理員仍可測試；必須再次明確授權才解除手動維護鎖。`openAt=2026-10-02T14:00:00.000Z` 保留作季度起始資料，已到時間不會解除 `enabled=true`；`activateAt=2026-11-01T16:00:00.000Z` 保留完整 11/1 的結季排程。掛機 `/api/idle/*` 使用共用 `requireAuth`，舊 JWT 同樣受維護、封鎖及工作階段失效門禁限制。既有 `gameSeasonState.activeKey=s20261001` 保留，未重置玩家資料。
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

## 2026/09 錨點停用與多人物換季

- `src/shared/anchorFeature.js`：錨點暫停開放，效果計算過濾而不改寫擁有資料；共用在 Web／Discord 戰鬥、PK、獎勵、簽到及強化。取得、裝備、拍賣、合成與圖鑑入口另設服務閘門。
- `seasonResetPolicy.js` 重置所有人物快照及帳號單人王進度；各人物稱號、收藏與永久物保留，裝備方案清空，避免切角帶回舊季資料。
- `scripts/test-anchor-disabled.js`、`test-season-reset-integration.js` 覆蓋停用及重置後三人物切換；`scripts/lib/season-preservation-audit.js` 比對永久資產與未變動集合。

### 霧隱林地事件卡

- 共用事件狀態與增益偷取白名單：`src/shared/mistwoodCards.js`。
- 戰鬥整合：`src/shared/combatLoop.js`，Web與Discord沿用同一核心。
- 七張卡資料與保留的怪物技能：`scripts/lib/mistwood-card-skills.js`。
- 資料遷移：`scripts/migrate-mistwood-card-skills.js`，套用前要求repository外BSON及metadata備份並回讀驗證；若已有玩家／拍賣卡片副本會拒絕遷移。
- 驗收：`scripts/test-mistwood-card-skills.js`；精確規則見 `COMBAT_FORMULA.md` 的霧隱林地事件卡段落。


### 一般區純普攻梯度與跨區經驗（2026/9/30）

`weaponBaseAttack` 將武器自身基礎攻擊與主屬性稀釋分開；`normalZoneExp` 依角色與區域等級帶計算個人 EXP 遞減；兩者分別由共用 `combatStats` 與 `grantKillCurrencyAndExp` 執行。管理員自訂戰鬥計算器可獨立選武器階級。

正式一般區怪物以 `basic-monster-gradient-20260930-agi-v2` 寫入；具體數值和校準驗收範圍見 `NORMAL_PROGRESSION.md`。`apply-normal-basic-gradient` 在寫入前解析驗證外部 BSON 備份、核對怪物來源、使用 CAS 保留現有戰鬥傷害與參戰者，不修改登入排程、道具、世界王或區域 BOSS 資料。

一般共鬥 EXP（2026/10/6）：有效傷害／支援者每人按怪物單隻 EXP×遭遇隻數×人數比例向上取整；1／2／3／4／5／6+ 人為100%／80%／85%／90%／95%／100%。基礎分配後套用既有個人加成、跨區與疲勞，金幣／掉落及世界王／副本原規則保留。

戰鬥流程查核：Web `playerAppRoutes`／Discord `monsterZoneHandlers` 讀取角色與合併最新裝備 → `calcPlayerStats` 計算屬性、階級套裝、武器、防禦與機率 → 讀取共享怪物血量、共鬥擴血及區域狀態 → `runCombatLoop` 執行回合（狀態／技能、玩家命中及普攻、連擊、怪物反擊、格擋／防禦、回合末效果）→ 同步傷害與剩餘血量 → 擊殺領取鎖 → 共用金幣／EXP／個人掉落結算 → 角色升級記錄與任務進度 → 戰報與下隻怪轉場。純普攻平衡測試刻意不啟用技能；正式技能流程保留。

驗證流程使用個人技能 `otonashi-game-verification`；固定腳本保存每项退出碼及完整難度報告。`check-normal-basic-gradient` 可讀正式 BSON 快照（不加 plan）或候選計畫；報告包含來源 hash、種子、場數及所有失敗，失敗時寫完報告再回傳非零碼。

### 新手首戰與新手資金（2026/9/30）

新手指引不再於新裝置登入時自動開啟；舊裝置尚未開始的自動歡迎提示也會收起，已主動開始的指引保留進度。玩家可由設定頁「重新觀看新手指引」手動開啟，任務頁的新手任務維持開放。新手指引明確建議先打草叢，準備D裝後前往起始草原、10等準備C裝挑戰陽光草原；出戰步驟提示取得装備後回背包比較與穿戴。新手資金領取失敗時保留指引與重試入口，成功後才結束。`onboarding/complete-reward` 使用帳號＋seasonKey組成穩定sourceRef，透過共用貨幣結算阻止回應失敗後重試或並發重複領取；一次性旗標仍跨人物共用，領取額1000金幣不變。


## 金屬主題地圖與裝備

鐵鳴礦城（`metal_mine`）40 等入場，六隻普通怪與礦城監造者提供磁鋼 A 裝；鋼冕王座（`metal_throne`）40 等入場，鎧冕王・赫鋼提供鋼冕 S 裝。每階 30 件（11 主手、盾／副刃／法典、物理與法術各八個防具／飾品欄位），統一金屬主題；元素仍採原鑲嵌規則。具名磁鋼套裝物／法三、五、七件效果與同階區域套裝同預算，七件的 15% 減傷只在上述兩區生效。

世界王進場等級：大史王（含單人版）30，其餘世界王40。Web／Discord 出戰驗證與 channel layout 綁定一致；世界王狀態回傳入場等級、等級不足原因並停用出戰。個人前置通關及活動王暫停設定繼續生效，等級不足在扣入場費前拒絕。

新王僅有本體，HP 150 萬、Lv.60、金4、30 分鐘討伐／60 分鐘重生；HP 低於 30% 後攻擊 +15%，不提高 AGI、不追加雷擊或部位機制。前端狀態圖示可點開說明。新一般區沿用共鬥最高五人擴血、獨立道具骰取及等級區間 EXP 修正。八張金屬區卡片、掉落來源與收藏已製作；Discord兩個入口已綁定，與網頁共用既有等級門檻、戰鬥及結算。詳細卡片及完整流程驗收見下方。

程式入口：`src/shared/zones.js`、`normalZoneExp.js`、`equipmentSetBonuses.js`、`src/services/worldBoss/worldBossService.js`、`src/services/createServiceContext.js`、`src/services/battle/bossMechanics.js`。內容生成／遷移：`scripts/lib/metal-content.js`、`scripts/migrate-metal-content.js`；驗收：`scripts/test-metal-content.js`、`scripts/verify-metal-content.js`。相關集合 `items`、`monsters`、`channelLayout`、`worldBossConfig`；遷移備份與逐欄讀回另存 repository 外，不修改玩家或維護狀態。

金屬區裝備詳細視窗：`src/shared/itemEffectLines.js` 依 `SET_DEFS` 顯示物／法 3、5、7 件套效果、同類 A／S 混搭及屬性石說明。單件沒有新增觸發技能；套裝仍依現行戰鬥程式計算。

- 鐵鳴礦城六種普通怪、礦城監造者與鎧冕王共八張正式透明 PNG，採舊式像素 RPG 風格、縮小比例並簡化裝甲材質，保留鋼灰／黃銅／青色磁核；由內建 imagegen 個別生成，素材提示詞與原始來源見 `docs/metal-monsters-imagegen-v3.json`。正式怪物 `imageUrl` 與 `imageThumbnailUrl` 使用 `/uploads/monsters/metal-1-v3.png` 至 `metal-8-v3.png`，舊圖保留。



- 磁鋼物／法套裝 5 件「磁力偏移」：8% 機率讓命中的物理攻擊傷害歸零；同類滿 5 件且主手裝備同系列 S 武器時提高至 12%，不逐件疊加，僅穿戴者有效；直接核對自身至少 5 件同類磁鋼裝備，光環、技能或卡片不能授予此效果。魔法、流血等持續傷害與精靈代承不適用。取代原 8% 固定物理減傷；7 件礦城／王座物理及魔法減傷 15% 保留。
- 龍鱗物／法套裝 5 件「龍鱗反傷」：30% 機率按普攻實際扣血量反彈 12% 傷害；同類滿 5 件且主手裝備同系列 S 武器時提高至 45%，不逐件疊加，護盾完全吸收、偏移、迴避或精靈代承不反傷。反傷不追加攻擊／連擊／卡片判定，仍套用怪物承傷保護。取代物理版連擊傷害與法術版魔穿；3 件與 7 件效果保留。

- 區域 S 武器（龍系／焚獄／真銀，共 33 件）的區域最終增傷 20% 已移除；基礎攻擊、屬性與其他武器特性保留。磁鋼／龍鱗 S 特性只提高上述發動機率。
- 怪物圖鑑對單一怪物的線性增傷上限為 10%；一般／BOSS／世界王需求數維持 100／50／10。軍師二轉兵聖「知彼」技能倍率維持 ×2，因此圖鑑滿額為 20%；其他計謀技能倍率保留。Web／Discord 與圖鑑說明共用 `shared/bestiary.js`。

### S 裝備開放範圍

A／S 一般穿戴裝備（主手、副手、六個防具槽與左右飾品）統一需要角色 Lv.30；D／C／B、卡片、稱號與職業徽章維持各自規則。`shared/equipmentLevel.js` 為門檻單一來源，手動穿戴、自動配裝及裝備方案切換都以道具庫最新階級檢查；29 等拒絕、30 等可穿戴。人物切換也檢查目標人物等級，將不合門檻的舊裝備完整退回共用背包並同步人物快照。背包 API 回傳 `equipRequiredLevel`／`equipLevelAllowed`，詳情顯示需求並停用不足等級的裝備按鈕。既有不足 30 等人物（包含非使用中的人物）的 A／S 裝備經備份後完整退回背包，保存實例、強化與附魔；不變更取得、交易或強化規則。

目前開放 S 主手武器，以及胡桃的三件 S 副手：對子・雙風脇差（`hutao-wind-offhand-sword`）、暗刻・羽切短刃（`hutao-wind-offhand-dagger`）、北風・四喜雀盾（`hutao-wind-shield`）。三件副手可取得、穿戴並計入屬性與四風效果，沿用單手／雙手武器互斥規則；主副手四風不重複疊加。其他 S 副手、S 防具與飾品仍暫停取得及穿戴，既有收藏保留但不計屬性、被動或套裝件數。共用 `sEquipmentFeature.js`／`equipmentAvailability.js` 控制掉落（含世界王額外獎勵）、離線掉落、商店、寶箱、製作、拍賣與穿戴；五件同系列有效套裝搭配同系列 S 主手武器才提高磁鋼／龍鱗特性機率。胡桃在10/8–10/15限時活動中開放討伐。

雙手主武器在所有具名套裝與 D／C／B／A／S 階級套裝均計2件；單手主武器、副手及其他槽位各計1件。跨過門檻時只啟動該門檻效果一次，武器自身被動不加倍。兩套計件共用 `shared/equipmentSetPieceWeight.js`，既有缺少 `isTwoHanded` 的道具快照也依武器種類辨識。

### 區域套裝特性同步

焚獄物／法 5 件改為「焚獄餘燼」：普攻主擊造成傷害且怪物存活時，20% 機率施加 2 回合灼燒，每跳為自身 ATK 20%；同系列 S 主手提高至 30%。灼燒沿用等級壓制、世界王 DOT 防禦及承傷保護，沒有百分比扣王血；同來源僅刷新，不疊層，不由副手、連擊、技能、卡片、反傷或 DOT 再觸發。

秘銀物／法 5 件改為「精準重擊」：普攻主擊命中時，20% 機率使本次傷害提高 30%；同系列 S 主手提高至 30%，傷害倍率不變。只強化同一次主擊，不追加攻擊，不額外強化副手／連擊／卡片／技能／反傷／DOT；在怪物每擊承傷上限之前計算，不能繞過無敵、減傷或傷害上限。光環、卡片或技能不能授予。兩系列舊 5 件爆傷／魔穿移除，3／7 件保留。磁鋼與龍鱗仍依原決策；所有系列 S 主手只提高特性機率、沒有恢復區域增傷，S 非主手暫停。

鋼鐵物／法 5 件追加「鋼鐵格擋」：既有格擋率 +8 個百分點，沿用現行物理普攻格擋結算及上限，原最大生命 +10%／+8% 保留。3／7 件不變；這是既有防禦套裝，未新增 S 鋼鐵武器或開放 S 防具。


### 金屬區完整取得與結算（2026-10-01）

`src/shared/metalCards.js` 定義鐵鳴礦城七張及鎧冕王一張事件卡；`scripts/migrate-metal-cards.js` 從已解析驗證的備份新增卡片、每怪1%卡片掉落來源及鎧冕王貢獻寶箱。卡片裝在 special_1/2/3，沿用原有收藏登錄；不新增防具鑲卡槽。卡片效果不會成為怪物主動技能，普通怪仍維持普攻。

| 卡片 | 現行效果（2026-10-02 V2） |
| --- | --- |
| 鐵屑鼠・碎鐵磨刃 | 主擊被格擋後下次主擊+20%，出手消耗、不疊加 |
| 磁針浮游砲・懸浮卸力 | 物理普攻連擊承傷-20%，第一擊不變 |
| 鎧甲穿山獸・層疊鋼甲 | 前3次物理普攻承傷依序-15/10/5% |
| 鏽刃斥候・磁刃追引 | 主擊落空後，下次主擊命中+10百分點，出手消耗 |
| 齒輪維修工・緊急焊補 | 首次HP<50%回復8%maxHP，每怪一次；組隊擊殺結算存活持卡者另回復5%maxHP，同怪防重、不復活 |
| 磁甲重兵・重錘定勢 | 未爆擊普通主擊傷害+8% |
| 礦城監造者・磁場鎖定 | 連續2次主擊落空後，下次主擊必定命中，不能穿無敵／免疫 |
| 鎧冕王・鋼冕浮游兵裝 | 4枚鋼刃，每3次主擊命中發射1枚，ATK70%金1傷害，受防禦／等級／元素及承傷保護；不爆擊／連擊／自連鎖 |

卡片不降防、不暈眩、不增打寶，不借用磁鋼套裝專屬偏移。王卡使用自己的金1屬性，不借用武器元素。傷害卡可依既有霧雷共鳴規則作一次合法來源，不能自我連鎖。Web普通／組隊畫面都有獨立鋼刃動畫及剩餘枚數；組隊結算顯示戰後整備實際回血量。新版沿用原8卡ID、怪物來源及1%掉率，已持有卡片不必重新取得。
驗收入口：`scripts/test-metal-cards.js`（8卡4,000場戰鬥、效果上限、DOT排除、承傷上限及怪物技能不變）；`scripts/test-metal-player-journey.js` 必須使用獨立 `acceptance_metal_*` MongoDB，走正式repository及service完成多人掉落、收藏、卡片穿戴、裝備強化、金屬性石鑲嵌、人物切換／重新讀取、同區光環、10次併發尾刀只一次結算、世界王助攻發箱與開箱／冷卻。測試不寫正式玩家資料，不開放一般玩家登入或S防具。

## 玩家圖片引導介面

SPA 以 `SceneReception`、`FeatureScene` 與 `PageShell` 統一功能入口的滿版場景（主線直接顯示章節）、妹妹／報到人員高清立繪與分類按鈕；右上角冒險手冊亦使用人物場景。背包保留直接可操作的裝備與物品格，人物展示以背包路由的目前設計為準。世界王包含 `battle.tsx` 的實際選怪及詳情。現行範圍、權限與確認流程見 [SCENIC_UI](SCENIC_UI.md)。


## 楓紅漸漸任務與通行證

現行實作：`scripts/migrate-autumn-quests.js`／`weeklyQuestService.js`／`autumnQuestRewards.js`／`passService.js`。舊每日、每週、賽季及錨點目標停用，定義與玩家歷史保留；職業任務保留。

| 週期 | 門檻 | 獎勵 |
| --- | --- | --- |
| 每日 | 出戰30、勝利20、報到1 | 每項金幣1,000，合計3,000 |
| 每週 | 出戰500、勝利300 | 各金幣6,000 |
| 每週養成 | 穿戴5、強化3、報到5 | 各金幣4,000 |
| 每週副本 | 通關20樓，Lv.30解鎖 | 金幣6,000 |
| 賽季 | 勝利3,000、副本100樓（Lv.30解鎖） | 各金幣10,000＋B強化寶石3 |

新任務不發EXP，不改逐級EXP需求、普通怪EXP或多人分配；副本不作每日完成前提。每日以台北日期重置、每週以現行台北週期重置，賽季任務使用現行賽季期間鍵。

通行證30級、每級250點，滿級7,500點；既有點數與已領紀錄保留，依新門檻重新換算等級；一般戰鬥D1／C2／B3／A5／S6，組隊副本每擊敗一樓加5點且同場結算重試不重複加點。普通獎勵不需鑽石開通，達到對應通行證等級即可領取；只有高級獎勵需5鑽解鎖，10／20／30級各回1鑽。

免費軌金幣合計114,750，加中金袋3個（各10,000），總金幣價值144,750；D強化石9、C15、B12、木／土／金／日／月石各1、重骰2。付費軌另有金幣229,500＋中金袋1，總金幣價值239,500；B強化石15、A12、水／火石各2、重骰3、重製1及回鑽3。不提供A武器箱，避免跳過40級裝備銜接。

領獎防呆：秋季任務Web／Discord共用持久收據；通行證開通與領獎序列化，貨幣固定sourceRef、道具與背包收據同筆CAS，發獎中斷後可重試。原有非秋季職業發獎路徑保留。

寵物頁提供鎖頭按鈕（`POST /api/me/pets/lock`），鎖定後 Web／Discord 放生及拍賣上架皆由後端拒絕，餵食、改名、出戰與採集不受影響。鎖定欄位以單獨原子更新保存；一般進度存檔保留較新的寵物清單與鎖定狀態，避免舊戰鬥快照刪除新寵物或復活已放生寵物。寵物飽食／採集的局部存檔以原始清單作條件更新，有競態時拒絕整筆操作。回歸：`node scripts/test-pet-lock-safety.js`，包含隔離 MongoDB 與具身分驗證的 HTTP 操作。

進度存檔會按裝備 UUID 合併鎖定狀態：未操作的鎖定欄位保留資料庫較新值，涵蓋背包、穿戴裝備與非使用中人物。較舊的未鎖定快照若要刪除後來才鎖定的裝備，整筆存檔回傳 `INVENTORY_LOCK_CONFLICT`（409），道具移除與分解產物一起不寫入。玩家明確鎖定／解鎖仍可使用；網頁多選分解維持排除鎖定裝備，未鎖定的強化裝備仍依原規則可被選取分解。回歸：`node scripts/test-equipment-lock-race.js`，使用獨立暫存 MongoDB。

進度儲存層的 `save`／`saveIfUnchanged` 排除 MongoDB 不可變 `_id`，避免通行證等功能以 `structuredClone` 複製背包後出現 code 66、道具領取失敗。已入帳貨幣沿用原收據，重新領取僅補完未完成的獎勵；玩家不用額外扣款。背包與一般區掉落收據內的道具庫 `_id` 以原始12位元組的24字元十六進位字串保存，避免 `structuredClone` 讓 BSON Binary 每次存檔再巢狀一層；角色文件頂層 `_id` 不變，收據、道具數量與已領貨幣不變。`node scripts/repair-embedded-mongo-ids.js` 預設預覽，`--apply --backup-dir=/repository外絕對路徑` 才套用，每筆先驗證 BSON 備份並以 `updatedAt` CAS 防止覆寫並行獎勵。回歸：`node scripts/test-embedded-mongo-ids.js`。回歸入口：`node scripts/test-pass-mongo-claims.js --items-snapshot=/absolute/path/items.bson`，使用正式儲存實作及隔離 MongoDB 驗證兩軌60筆領獎、並行、發獎中斷重試與舊版本寫入拒絕。

本輪服務修正：拍賣先留待託管意圖，再以背包CAS移除道具、正式上架；原子貨幣扣款與入帳、持久發貨／領回收據，中斷保持待結算；普通裝備、寶石、蛋、寵物保留原交易限制。金幣稅10%、鑽石不抽稅。商店數量必須1～999整數，商品庫存按商品序列化。簽到以台北日期、平台帳號當日持久保留與固定貨幣收據，倍率先留待完成收據。賭場每人每輪一注、整數金額；開獎結果與掉落判定持久化，結算失敗保留原輪重試，不提前輪替；D/C/B/A普通卡片池依monsterCardOf／monster_card識別，排除NPC、世界王、限定與未開放卡。

隔離驗證入口：`node scripts/test-side-systems.js --items-snapshot=/absolute/path/items.bson`；所有測試寫入MongoMemoryServer，不使用正式服務Context。舊`test-pet-lifecycle.js`屬已過時的寵物升級測試，預設拒絕執行，現行驗收改測孵化時固定D/C/B/A位階。

通行證S階寶石補充（2026-10-04）：免費軌第25／30級各1顆，共2；付費軌第20／25／30級各1顆，另3。兩軌全領共5顆，保留原有獎勵及點數／售價，不改世界王掉率。

## 本季正式開放與門禁

2026/10/4 21:00（台灣時間）依使用者明確授權開放「楓紅漸漸」。MongoDB `maintenanceState` 的 `enabled=false`、`strict=false`、`openAt=2026-10-04T13:00:00.000Z`；`activateAt=2026-11-01T16:00:00.000Z` 保留，玩家可玩完整個11/1。管理員白名單不變；未重置玩家、不發布Discord訊息、不改活動王私測開關。正式登入狀態由 `/api/maintenance` 及目前MongoDB控制，文件日期不可替代門禁現況。登入後仍需合法JWT，匿名玩家API回401。

RO OBS 聊天室本季七稱號均套用整個楓葉聊天框：名字列暖金漸層、楓紅外框、奶油暖底訊息區及角落楓葉；稱號名牌同樣加楓葉標記。依已穿戴稱號辨識，未裝備不顯示、其他稱號沿用銀藍名牌。來源仍為 `/static/chat.html` 與 `/static/chat-ro.css`；CSS以版本參數更新快取，既有OBS瀏覽器來源須重新整理才能讀到新版。`?preview=1` 包含本季與其他稱號樣本。


## 登入前首頁主視覺 0.6.0

登入頁使用 `/season/2026-autumn-character-060.webp` 的楓紅漸漸人物主視覺，截取人物區域並放大鋪滿，不顯示宣傳圖左側標題與重點區；版本標籤為 Ver 0.6.0。來源為 SPA `src/routes/login.tsx`，登入與維護門禁沿用現行 API。

OneComme 雀魂自訂模板 `otonashi-mahjong-chat` 透過公開 viewer-profile 查詢觀眾已穿戴稱號。本季七稱號套用整個楓紅雀魂聊天框與楓葉牌，依平台／userId快取30秒、共用並行請求，超時3秒或查詢失敗維持原框，不阻塞留言與原有自動捲動。CSS同步本機麻將樣式檔；使用此自訂模板的OBS来源须刷新。單純貼CSS至其他OneComme模板不會自行取得遊戲稱號。

### 圖鑑收集效果與獎勵展示

Web 寵物與卡片圖鑑左頁在收集進度下常駐展示里程碑。寵物列出分數門檻、永久效果、称號及達成狀態，同類加成取最高值、不相加，資料來源為 `PetService.getDex` 的 milestones／bonus。卡片列出總收集門檻、各區及主線角色卡完整收藏獎勵，显示金幣、道具、稱號及可領／已領狀態，沿用現有圖鑑領獎API。

對外雀魂聊天室使用 `/static/chat.html?theme=mahjong`，透過既有伺服器 SSE 中繼接收留言，其他電腦不需啟動 OneComme。`preview=1` 可免金鑰預覽。使用 `chat-mahjong.css` 適配對外聊天室 DOM，與 RO 共用會員／已穿戴七稱號資料及楓葉整框判定；本機 OneComme 模板仍保留。

對外 OBS 聊天室採免金鑰公開留言來源：RO、雀魂、聊天彈幕與聊天跑馬燈均直接連接 `/api/chat/overlay-stream`，不需要網址金鑰、登入或 localStorage 金鑰。原本帶 key 的網址仍可使用（參數忽略）。只有留言中繼改為公開，遊戲／管理員 API 授權保持既有規則；SSE 連線數上限與斷線清理仍啟用。後續聊天室樣式同樣使用免金鑰來源。

管理者執行正式重啟前，`pre-pm2-restart-hotfix.js` 直接透過 Discord REST 發送至玩家聊天區 `1498608950671839263`，5 秒超時，需取得該頻道訊息ID才成功；公告失敗以非零狀態阻擋 npm 重啟。`npm run pm2:restart` 自動先執行；直接 PM2 操作同樣必須先公告。此規則涵蓋人工發布重啟，既有 PM2 自動故障恢復／定時重啟未改動。

Web 等級排行的「最高角色」與「帳號總養成」皆顯示前50名，底部標示實際顯示名數與全服上榜人數；自己的名次仍獨立顯示。API `/api/leaderboard/level` 支援 `limit`（上限50；省略時預設10）。

等級榜及帳號總養成榜只納入已獲得至少1 EXP的角色：Lv1且EXP0的角色不計入人物數／總等級；全帳號皆未練功者不列榜、自己的rank為null。Lv2以上即使目前EXP0仍保留（升級消耗EXP不會失去資格）。共用characterLevelSummary earnedOnly模式，Web及Discord／管理端等級榜同步。PK排行榜暫停入口及API（403 FEATURE_DISABLED），PK對戰與既有評分資料保留。

## 世界王寶箱獎池

世界王寶箱共用 `battleRewardRules.buildMonsterDropPool()` 的實戰掉落表，包含補入的王卡。以目前可掉落道具的 chance 作權重抽出一項；舊 `chestDrops` 不再限制獎池，也不另排除 S 強化寶石。停用裝備與實戰採相同的 `equipmentAvailability` 判定。胡桃現行為13件S武器（含2件副手）各5%、8件A套裝各4.25%、王卡1%，總權重100。抽選結果在存檔重試時沿用，寶箱消耗及獎勵一起保存。

2026-10-08 赫鋼暫停新入場，待強度調整；正式 `worldBossConfig.steel_crown.value.enabled=false`，其他世界王開關不變。詳見 [赫鋼現行規則](STEEL_CROWN_BOSS.md)。

2026-10-08 胡桃新增全場每15秒立直：50% AGI−30／15秒、25% 300%ATK全體重擊、25% 胡桃暴擊率＋50個百分點／15秒。規則見 [活動世界王](EVENT_WORLD_BOSSES.md)，共用判定由 `services/realtime/hutaoBossRiichi.js` 與即時戰鬥 CAS 提交。
