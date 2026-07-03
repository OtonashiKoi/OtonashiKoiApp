# 系統索引 SYSTEMS

> 這份是「有哪些系統、程式在哪」的**索引地圖**，方便日後快速定位。遊戲資料（怪物/道具/任務現況）請看 `docs/CURRENT_GAME_STATUS.md`（`npm run status:update` 產生）。
>
> 架構：後端 Node.js（Discord Bot + Express API）在 `otonashiKoi_game`（＝符號連結 `equipmentGAME`，PM2 跑這個）；玩家網頁前端 React app 在 `~/Documents/equipmentGAME-app`（build+deploy 到後端 `src/web/public/app`）。DB＝本機 MongoDB `equipmentGame`。
>
> 共用核心：戰鬥 `src/shared/combatLoop.js`、`combatStats.js`、`effectEngine.js`；區域單一來源 `src/shared/zones.js`；服務組裝 `src/services/createServiceContext.js`；Mongo repo `src/adapters/mongo/createMongoRepositories.js`、索引 `createMongoClient.js`。

---

## 玩法系統

### ⚔️ 怪物 / 區域 / 戰鬥
- 後端：`services/monster/monsterService.js`；戰鬥核心 `shared/combatLoop.js`；區域 `shared/zones.js`
- API：`routes/playerAppRoutes.js`（`/api/combat/quick-battle`、zones）
- 後台：怪物資料庫 `admin.monsters.js`、傷害測試 `admin.combat-calculator.js`
- DC：`bot/handlers/monsterZoneHandlers.js`、`bot/monsterZoneView.js`
- 前端：`routes/battle.tsx`、`hooks/useBattle.ts`
- Collections：`monsters`、`monsterState`（`_id: monsterState:<zone>`，含 `worldBossPartsHp`）

### 👑 世界王 World Boss（大史王 elite / 古龍王 dragon_king_lair）
- 後端：`services/worldBoss/worldBossService.js`（大史王 default + 古龍王 dragon_king，`worldBossServiceFor(zone)`）
- 部位戰鬥/寶箱：`bot/handlers/monsterZoneHandlers.js`；網頁部位戰在 `playerAppRoutes.js`（見 [[worldboss-chest-grant]] 記憶）
- 前端：`routes/worldboss.tsx`、`hooks/useWorldBoss.ts`、`useWorldBossAlarm.ts`
- Collections：`worldBossConfig`、`worldBossState`、`worldBossChestGrants`（發箱稽核）

### 🗼 試煉之塔 Tower（單人無盡 + 組隊）
- 後端：`services/tower/`（`towerPartyRooms.js`）；API 在 `playerAppRoutes.js`（`/api/tower/*`、`/api/tower/party/*`）
- DC：`bot/handlers/towerHandlers.js`、`bot/towerView.js`
- 前端：`routes/battle.tsx`（TowerPanel/TowerPartyPanel）、`hooks/useTower.ts`、`useTowerParty.ts`

### 🤖 掛機 Idle
- 後端：`services/idle/idleService.js`；API `routes/playerIdleRoutes.js`、後台 `adminIdleRoutes.js`
- 後台：`admin.idle.js`；DC：`bot/handlers/idleZoneHandlers.js`、`bot/idleZoneView.js`
- 前端：`routes/battle.tsx`(IdlePanel)、`hooks/useIdle.ts`
- Collections：`idleZones`、`idlePlayerStates`

### ⚔️ PK 競技場
- 後端：`shared/pkCombat.js`；`repositories.pkArenaRepository`（collection `pkArenaState`）
- DC：`bot/handlers/pkArenaHandlers.js`、`bot/pkArenaView.js`；前端 `hooks/usePk.ts`

### 🎰 命運轉盤 Casino
- 後端：`services/casino/casinoService.js`；後台 `admin.casino.js`；DC `bot/handlers/casinoHandlers.js`、`bot/casinoView.js`
- 前端：`routes/casino.tsx`、`hooks/useCasino.ts`；Collections：`casinoState`、`casinoRounds`(TTL 30天)

### 🐾 寵物 Pet
- 後端：`services/pet/petService.js`；DC `bot/handlers/petHandlers.js`、`bot/petPanelView.js`
- 前端：`routes/pets.tsx`、`hooks/usePets.ts`；資料存 `progress.pets`

### 🀄 麻將 Mahjong
- 後端：`services/mahjong/`；API `routes/mahjongRoutes.js`

---

## 道具 / 經濟

### 🎒 道具 / 裝備 / 背包
- 後端：`services/item/itemService.js`；換裝/卸裝/丟棄在 `services/shop/shopService.js`
- 後台：道具庫 `admin.items.js`、怪物卡 `admin.monster-cards.js`
- 前端：`routes/inventory.tsx`、`hooks/useInventory.ts`；Collections：`items`
- 註：`item.id`=系統UUID，`item._id`=ObjectId；裝備槽含 title_eq(稱號)、job_eq(職業徽章)、anchor(錨點)、special_1~3(卡片)

### ⚒️ 強化 Enhance
- 後端：`services/enhance/enhanceService.js`；前端 `routes`(forge)、`hooks/useEnhance.ts`；API `playerForgeRoutes.js`

### 🛒 金幣商店 Shop
- 後端：`services/shop/shopService.js`；後台 `admin.shop.js`；DC `bot/handlers/coinShopHandlers.js`、`bot/coinShopView.js`
- 前端：`routes/shop.tsx`、`hooks/useShop.ts`；Collections：`shopItems`、`shopClaims`

### 🏛️ 拍賣場 Auction
- 後端：`services/auction/auctionService.js`；後台 `admin.auction.js`；DC `bot/handlers/auctionZoneHandlers.js`
- 前端：`routes/auction.tsx`、`hooks/useAuction.ts`

### 💰 錢包 / 交易 / 發獎
- 後端：`services/wallet/walletService.js`、`transaction/transactionService.js`、`reward/rewardService.js`
- 前端：`routes/transactions.tsx`、`hooks/useTransactions.ts`；Collections：`wallets`、`transactions`(打怪紀錄掛TTL)

### ✨ 效果引擎 Effects
- 後端：`shared/effectEngine.js`、`services/effect/effectDefinitionService.js`
- 後台：`admin.effects.js`、`admin.effect-modules.js`；DC 動作模板 `admin.animation-studio.js`
- Collections：`effectDefinitions`

---

## 任務 / 成長 / 主線

### 📋 任務系統（新手/職業/每日/每週/**賽季**）
- 後端：`services/weeklyQuest/weeklyQuestService.js`（cadence: onboarding/job/daily/weekly/**season**；type 見檔內 QUEST_TYPES）
- API：`routes/adminWeeklyQuestRoutes.js`（後台 `/admin/quests/*` + 玩家 `/api/quests`、`/api/quests/:id/claim`；發獎 `grantQuestReward`）
- 後台：`admin.weekly.js`（cadence 含「賽季成就」；獎勵可選任何道具含**稱號 title_eq**）
- 前端：`routes/quests.tsx`、`hooks/useQuests.ts`（Tab 含 season）
- DC：`bot/weeklyQuestView.js`；Collections：`weeklyQuests`(定義)、`weeklyQuestProgress`(進度，`{discordId,cadence,periodKey}` unique)
- **賽季稱號**：建 cadence=season 任務、獎勵選稱號 → 玩家任務頁自領（已驗證可行，達成紀錄自帶 discordId）

### 🎭 主線劇情 Story（文字冒險）— 2026-07 新建
- 見獨立記憶 [[story-system]]。後端 `services/story/storyService.js` + `routes/storyRoutes.js`；reader `equipmentGAME-app/routes/story.tsx`；後台 `admin.story.js`（admin.html「🎬 主線劇情」）
- Collections：`storyChapters`、`storyNpcs`；玩家進度 `progress.storyProgress`

### 📅 打卡 Checkin
- 後端：`services/checkin/checkinService.js`；前端 `hooks/useCheckin.ts`；Collections：`checkins`

### 🏅 玩家等級 / 會員 Tier
- 後端：`services/playerTier/playerTierService.js`；後台 `admin.tiers.js`；Collections：`playerTiers`（對應 Discord 身分組）

### 📖 圖鑑 Collection（怪物/寵物）
- API：`routes/playerCollectionRoutes.js`；前端 `routes/collection.tsx`、`hooks/useCollection.ts`；資料 `progress.bestiary`、`progress.petDex`

---

## 玩家 / 平台 / 管理

### 👤 玩家 / 進度
- 後端：`services/player/playerService.js`、`progress/progressService.js`；Collections：`players`(discordId)、`progress`(playerId)

### 🔐 登入 / 權限 / 維護
- 網頁登入：`playerAppRoutes.js`（`/api/auth/discord`，requireAuth.js）
- 存取封鎖：`services/access/webBanStore.js`(webAccessControl)；**賽季維護** `services/access/maintenanceStore.js`（見 [[season-maintenance-mode]]）
- 權限白名單：`services/admin/accessControlService.js`；後台「權限與白名單」
- Collections：`accessControl`、`webAccessControl`、`maintenanceState`

### 📺 直播綁定 / 抖內換鑽石
- 後端：`services/stream/`、`services/creatorAuth/creatorTokenService.js`；OneComme 留言 `bot/commentFetcher.js`、`onecommeSender.js`
- 綁定 ID 格式坑見 [[stream-binding-id-prefix]]；Collections：`streamAccountBindings`、`creatorTokens`
- 斗內管線：OneComme→`bot/handlers/streamHandlers.js` `handleDonation()`（NT$/100 換鑽、零頭累積 `donationLedger`、`transactions` 冪等）

### 📊 直播記錄層（直播連動事件的資料底層）— 2026-07 新建
- 見記憶 [[stream-records-layer]]。後端 `services/stream/streamRecordsService.js`（記錄+查詢）、`services/stream/membershipTracker.js`（Discord tier 身分組 diff）
- 掛點：斗內→`streamHandlers.js handleDonation`（每筆記 `donationEvents`，含未綁定/未滿百）；會員→`bot/client.js` GuildMemberUpdate→trackMembershipChange
- 後台：`admin.stream-records.js`（admin.html「📺 直播記錄」，監控與紀錄群組）；API `routes/adminStreamRecordsRoutes.js`
- Collections：`donationEvents`(逐筆斗內)、`membershipEvents`(會員變動流水)、`membershipStatus`(會員現況表)、`serverBuffs`、`serverEventConfig`
- 會員到期＝快照比對 `membershipTracker.reconcileMembership`(每12h+後台「🔁立即同步」)，不改身分組；⚠️續約(renew)需後續接 YouTube 會員 API

### 🎉 全服 Buff / 直播觸發（第二階段模組0+A，2026-07 上線）
- 核心：`services/stream/globalBuffService.js`(記憶體快取全服掉寶/金幣/經驗%加成，index.js啟動init)
- 注入 chokepoint：`buildRewardModifiers()`(monsterZoneHandlers ~1458，涵蓋Discord/網頁/世界王) + `idleService.js`掛機兩處
- 斗內觸發：`donationBuffTrigger.js`掛 handleDonation；設定 `streamEventConfig.js`(預設關)；後台「🎉全服活動」分頁 + adminStreamRecordsRoutes `/admin/stream-events/*`
- SC累積解鎖、直播限定王尚未做

### 💬 聊天大廳 Chat（網頁 ↔ DC town_chat）
- 後端：`services/chat/`；SSE + Discord 同步在 `playerAppRoutes.js`（`_announceTownChat`）
- 前端：`routes/chat.tsx`、`hooks/useChat.ts`

### 📢 公告 / 通知 / 熱更新
- 後端：`services/announcement/`；`playerAppRoutes.js`（`_broadcastForceReload`/`_broadcastMaintenance`）
- 後台廣播端點：`adminPlayerRoutes.js`（`/admin/broadcast/maintenance`、`/admin/broadcast/announce-and-reload`）— 見 [[restart-maintenance-notice]]
- 前端：`routes/notifications.tsx`、`hooks/useAnnouncements.ts`；即時 `services/realtime/`(playerEventBus/webPresence)

### 🎟️ 邀請碼 Invite
- 後端：`services/invite/inviteService.js`；前端 `hooks/useInvite.ts`；Collections：`inviteCodes`

### 🎛️ 後台總控 / Discord 版位
- 後端：`services/admin/adminConsoleService.js`、`adminService.js`；API `adminConsoleRoutes.js`、`adminPlayerRoutes.js`
- 頻道綁定：`channelLayout`(collection `_id:default`，featureKey→channelId)；後台「功能版位設定」`admin.bindings.js`
- 後台框架：`admin.html` + `adminLayout.js`/`admin.core.js`/`admin.nav-search.js`；操作紀錄 collection `adminActionLogs`

---

## 部署 / 維運速查
- 後端重啟：`npx pm2 restart equipmentGAME --update-env`（見 [[restart-backend]]）；重啟前發維護預告 [[restart-maintenance-notice]]
- 前端 deploy：`cd ~/Documents/equipmentGAME-app && npm run build && npm run deploy`
- 後台是後端直吐靜態頁（改 `admin.*.js` 後重啟即生效；`admin.html` 引用要 bump `?v=`，且瀏覽器會快取 admin.html→常需強制重整）
- 對外：otonashikoi.org 走 Cloudflare tunnel→localhost:5566（見 [[domain-deploy-setup]]）；後台 otonashikoi.org/admin.html（管理員密碼）
- 現況文件：`npm run status:update` → `docs/CURRENT_GAME_STATUS.md`
