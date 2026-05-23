# equipmentGAME 全系統架構圖

> 最後更新：2026-05-23
> 本文件涵蓋 Discord Bot、Web API、Web 前端、MongoDB、OAuth 整合的完整關係。

---

## 1. 高層架構

```
                       ┌─────────────────────────────────────┐
                       │           MongoDB (本地)             │
                       │   equipment_game (23 Collections)   │
                       └─────────────────┬───────────────────┘
                                         │
                ┌────────────────────────┼────────────────────────┐
                │                        │                        │
       ┌────────▼────────┐      ┌────────▼────────┐      ┌────────▼────────┐
       │  Discord Bot    │      │   Express API   │      │  Admin Console  │
       │  (discord.js)   │      │   :3000         │      │   (HTML/JS)     │
       │                 │      │                 │      │                 │
       │  - Commands     │      │ /api/me/*       │      │ /admin/console  │
       │  - Buttons      │      │ /api/combat/*   │      │ /admin/monsters │
       │  - Modals       │      │ /api/shop/*     │      │ /admin/quests   │
       │  - Embeds       │      │ /api/idle/*     │      │ /admin/items    │
       │  - Voice / SSE  │      │ /api/quests/*   │      │ /admin/world-boss│
       └────────┬────────┘      │ /api/mahjong/*  │      └─────────────────┘
                │               │ /api/me/bindings│
                │               └────┬────────────┘
                │                    │
                │                    │  Discord OAuth
                │                    │  + JWT
                │                    │
                │                    ▼
                │           ┌────────────────────┐
                │           │  Web 前端 (Vite)   │  ← equipmentGAME-app
                │           │  React 19 + TS     │
                │           │  TanStack Router   │
                │           │  TanStack Query    │
                │           │  Zustand (auth)    │
                │           │  Tailwind v4       │
                │           │  Framer Motion     │
                │           └────────────────────┘
                │
                │  Twitch / YouTube
                ▼  Membership API
       ┌─────────────────┐
       │  Stream Auth    │
       │  (OAuth)        │
       └─────────────────┘
```

---

## 2. Repo 結構

### `equipmentGAME/`（後端 + DC Bot 主 repo）

```
equipmentGAME/
├── src/
│   ├── bot/                    # Discord Bot
│   │   ├── client.js           # Bot 啟動
│   │   ├── commands.js         # 斜杠命令定義
│   │   ├── playerPanel.js      # 我的資料、背包、裝備、強化
│   │   ├── playerPanelView.js  # 玩家面板 BUTTON_IDS
│   │   ├── monsterZoneView.js  # 怪物區 UI
│   │   ├── towerView.js        # 爬塔 UI
│   │   ├── playerPanel.js      # handleProfile/Backpack/...
│   │   └── handlers/           # 互動 handlers
│   │       ├── monsterZoneHandlers.js
│   │       ├── pkArenaHandlers.js
│   │       ├── towerHandlers.js
│   │       ├── auctionHandlers.js
│   │       └── publishHandlers.js
│   │
│   ├── api/                    # Express API
│   │   ├── server.js           # API 主程式
│   │   └── routes/
│   │       ├── playerAppRoutes.js     # /api/me/* + /api/combat/* + /api/shop/*
│   │       ├── playerIdleRoutes.js    # /api/idle/*
│   │       ├── adminWeeklyQuestRoutes.js  # /api/quests + /api/weekly-quests
│   │       ├── mahjongRoutes.js       # /api/mahjong/*
│   │       ├── adminConsoleRoutes.js  # 後台
│   │       ├── adminMonsterRoutes.js
│   │       ├── adminCreatorAuthRoutes.js
│   │       └── healthRoutes.js
│   │
│   ├── services/               # 業務邏輯層
│   │   ├── playerService.js
│   │   ├── walletService.js
│   │   ├── shopService.js
│   │   ├── monsterService.js
│   │   ├── idleService.js
│   │   ├── weeklyQuestService.js
│   │   ├── creatorTokenService.js
│   │   └── ...
│   │
│   ├── adapters/mongo/         # DB Repository 層
│   │   ├── createMongoClient.js
│   │   ├── createMongoRepositories.js
│   │   ├── playerRepository.js
│   │   ├── progressRepository.js
│   │   ├── walletRepository.js
│   │   ├── itemRepository.js
│   │   ├── monsterRepository.js
│   │   └── ...
│   │
│   ├── shared/                 # DC + API 共用
│   │   ├── combatStats.js      # ⭐ 戰鬥能力公式（DC/Web 同一份）
│   │   ├── combatLoop.js       # 戰鬥循環
│   │   ├── effectEngine.js     # Buff/Debuff/Skill 引擎
│   │   ├── zones.js            # Zone 定義（單一來源）
│   │   ├── progression.js      # 等級 / EXP 公式
│   │   └── response.js         # ok/fail 包裝
│   │
│   └── web/public/             # Admin Console 前端
│
├── scripts/                    # 維護腳本
│   ├── pm2-reset.js
│   ├── status-update.js        # → docs/CURRENT_GAME_STATUS.md
│   └── ...
│
├── docs/
│   ├── CURRENT_GAME_STATUS.md  # 由 MongoDB 自動生成（npm run status:update）
│   ├── ARCHITECTURE.md         # ← 本文件
│   └── OAUTH_SETUP_GUIDE.md
│
├── ecosystem.config.cjs        # PM2 設定
└── package.json
```

### `equipmentGAME-app/`（Web 前端獨立 repo）

```
equipmentGAME-app/
├── src/
│   ├── routes/                 # TanStack Router 路由
│   │   ├── rootRoute.tsx       # 根路由
│   │   ├── index.tsx           # / 首頁（玩家儀表板）
│   │   ├── login.tsx           # /login Discord OAuth
│   │   ├── battle.tsx          # /battle (練功/掛機/PVP/爬塔)
│   │   ├── inventory.tsx       # /inventory (15 槽 + 6 分頁)
│   │   ├── shop.tsx            # /shop
│   │   └── settings.tsx        # /settings (綁定)
│   │
│   ├── components/
│   │   ├── PageShell.tsx       # 共用殼層 (背景 + TopBar + BottomNav)
│   │   ├── PageBanner.tsx      # 頁面標題 banner
│   │   ├── Tabs.tsx            # 分頁切換器 + Placeholder
│   │   ├── Placeholder.tsx     # 空狀態佔位
│   │   ├── RouteTransition.tsx # 路由過場動畫
│   │   └── TopBar.tsx (legacy)
│   │
│   ├── hooks/                  # TanStack Query hooks
│   │   ├── useProfile.ts       # /api/me/profile
│   │   ├── useInventory.ts     # /api/me/inventory + equip/unequip/use/discard/sell
│   │   ├── useBindings.ts      # /api/me/bindings
│   │   ├── useBattle.ts        # /api/combat/zones + quick-battle
│   │   ├── useShop.ts          # /api/shop/*
│   │   ├── useIdle.ts          # /api/idle/*
│   │   └── useRealtimeSync.ts  # SSE 即時同步
│   │
│   ├── lib/
│   │   ├── api.ts              # axios + JWT 攔截器
│   │   └── auth.ts             # Zustand auth store
│   │
│   ├── home/                   # 早期 Pixi.js 嘗試（已 deprecated）
│   ├── index.css               # Tailwind v4 + HSR 配色變數
│   └── main.tsx
│
├── public/
│   ├── assets/                 # AI 生成素材（已不主用）
│   ├── atoms/clean/            # chroma-key 後的乾淨素材
│   └── bg/                     # 場景背景圖
│
└── scripts/                    # 影像處理
    ├── chroma-key.mjs
    └── extract-panels.mjs
```

---

## 3. 玩家認證流程

```
┌────────────┐                                              ┌────────────┐
│  瀏覽器     │                                              │  Discord   │
└─────┬──────┘                                              └─────┬──────┘
      │                                                            │
      │  1. GET /login → 點「用 Discord 登入」                        │
      │                                                            │
      │  2. redirect → Discord OAuth (client_id, redirect_uri)     │
      ├───────────────────────────────────────────────────────────►│
      │                                                            │
      │  3. Discord callback ?code=xxx                             │
      │◄───────────────────────────────────────────────────────────┤
      │                                                            │
      │                                ┌──────────────┐            │
      │  4. POST /api/auth/discord     │ Express API  │            │
      ├────────────────────────────────►              │            │
      │     { code }                   │              │            │
      │                                │ ▼ 換 token   │            │
      │                                │ ▼ 找 user    │            │
      │                                │ ▼ 簽 JWT     │            │
      │  5. { jwt, player }            │              │            │
      │◄───────────────────────────────┤              │            │
      │                                └──────────────┘            │
      │  6. Zustand 儲存 jwt 到 localStorage                         │
      │                                                            │
      │  7. 之後所有 API 帶 Authorization: Bearer <jwt>              │
      │                                                            │
```

JWT payload：`{ discordId, displayName, exp }`，密鑰 `JWT_SECRET`，TTL 7 天。

---

## 4. 戰鬥數值計算流（單一來源原則）

```
                  MongoDB.progress
                  ┌─────────────────┐
                  │  attributes     │ STR/AGI/VIT/INT/DEX/LUK
                  │  equipment      │ 15 槽裝備物件
                  │  activeEffects  │ Buff/Debuff
                  │  inventory      │ 持有道具
                  └────────┬────────┘
                           │
                           ▼
                ┌──────────────────────┐
                │ shared/combatStats   │  ← ⭐ DC 與 Web 共用同一支
                │ calcPlayerStats()    │
                │                      │
                │  → maxHp, atk, def   │
                │  → hit, dodge, block │
                │  → crit, combo       │
                │  → weaponType        │
                │  → tierSetBonuses    │
                └──────┬───────────────┘
                       │
            ┌──────────┴──────────┐
            │                     │
            ▼                     ▼
   ┌────────────────┐    ┌────────────────┐
   │ DC handleProfile│    │ /api/me/profile│
   │ 顯示 embed     │    │ JSON 回前端     │
   └────────────────┘    └────────┬───────┘
                                  │
                                  ▼
                         ┌────────────────┐
                         │ Web 首頁面板    │
                         │ 戰鬥能力 grid   │
                         └────────────────┘
```

**保證**：DC 顯示的 HP/ATK/DEF 與 Web 顯示永遠相同。

---

## 5. 完整功能矩陣

### 🟢 Web 已實作（8）
| 功能 | API | Web 路徑 |
|---|---|---|
| 我的資料 | GET `/api/me/profile` | `/` |
| 背包 + 15 槽裝備 | GET `/api/me/inventory` + equip/unequip | `/inventory` |
| 練功（5 zones） | GET `/api/combat/zones` + POST `/api/combat/quick-battle` | `/battle` 練功 |
| 掛機 | `/api/idle/{status,zones,start,claim,cancel}` | `/battle` 掛機 |
| 商店 | GET `/api/shop/items` + POST `/api/shop/buy/:id` | `/shop` |
| 直播綁定 | GET `/api/me/bindings` + OAuth | `/settings` |
| 等級 / EXP / 資產 | profile 內含 | TopBar |

### 🟡 Web 缺，後端 API 已有（5）
| # | 功能 | API |
|---|---|---|
| 9 | **任務系統** | GET `/api/quests` + POST `/api/quests/:id/claim` + GET `/api/weekly-quests` + claim |
| 10 | 裝備強化 | GET `/api/me/enhance/:uuid` + POST `/api/me/inventory/enhance` |
| 11 | 麻將 | GET `/api/mahjong/state` + SSE `/api/mahjong/stream` + POST join/move/reorder |
| 12 | 道具使用/丟棄/出售 | POST `/api/me/inventory/{use,discard,sell}/:uuid` |
| 13 | 打卡狀態 | 經 transactions 推算 |

### 🟠 DC-only，需開後端 API（8）
PK 競技場 / 爬塔 / 拍賣行 / 邀請碼 / 交易紀錄 / 怪物事件 / 幣商兌換 / 世界王玩家面

### ⚪ 完全未實裝（10）
寵物 / 公會（樂團？）/ 釣魚採集 / 製作 / 信箱 / 商品兌換 / 隱私設定頁 / 稱號職業切換 UI / 頭像自訂 / 組隊系統

---

## 6. MongoDB Collections（23）

### 玩家資料
- `players` — Discord 玩家主檔
- `progress` — 等級、屬性、裝備、徽章
- `wallets` — 金幣、鑽石
- `transactions` — 交易紀錄
- `checkins` — 打卡紀錄

### 道具
- `items` — 道具總表（系統定義）
- `inventory` — 玩家持有（已併入 progress.inventory）
- `equipment` — 玩家裝備（已併入 progress.equipment）
- `shopItems` — 商店商品池
- `shopClaims` — 商店認領紀錄

### 戰鬥
- `monsters` — 怪物定義
- `monsterState` — 各 zone 怪物當前 HP
- `monsterEvents` — 怪物事件觸發紀錄
- `worldBossConfig` / `worldBossState`
- `pkArenaState` — PK 競技場狀態
- `towerSessions` — 爬塔會話

### 任務
- `weeklyQuests` — 任務定義（含 onboarding/job/daily/weekly）
- `weeklyQuestProgress` — 玩家任務進度

### 掛機 / 麻將
- `idleZones` / `idlePlayerStates`

### 系統
- `inviteCodes` — 邀請碼
- `battleConfig` — 戰鬥設定
- `effectDefinitions` — Buff/Debuff 定義
- `playerTiers` — E~SS 階級設定
- `channelLayout` — 頻道綁定
- `accessControl` / `adminActionLogs`
- `creatorTokens` / `streamAccountBindings` — 直播 OAuth

---

## 7. 共享業務邏輯（DC + Web 必共用）

| 模組 | 路徑 | 用途 |
|---|---|---|
| `combatStats.calcPlayerStats` | `src/shared/combatStats.js` | ⭐ 戰鬥能力公式 |
| `combatLoop.runBattle` | `src/shared/combatLoop.js` | 一回合戰鬥模擬 |
| `effectEngine` | `src/shared/effectEngine.js` | Buff/Debuff 計算 + 裝備 effects 收集 |
| `zones.ZONE_KEYS` | `src/shared/zones.js` | Zone 單一來源（不可 hardcode） |
| `progression.expToNextLevel` | `src/shared/progression.js` | 等級 EXP 曲線 |

**⚠️ 紀律**：所有玩家可見數值計算都必須走 shared，不可在 DC 或 Web 任一端獨立實作。

---

## 8. 部署 & 環境

| 服務 | 跑哪 | 啟動 |
|---|---|---|
| Discord Bot + API | PM2 process `equipmentGAME` | `npm run pm2:reset` |
| MongoDB | 本地 `mongod`（wiredTiger 固定 dbPath） | 開機自動 |
| Web 前端 dev | Vite :5180 | `npm run dev` |
| Web 前端 prod | （規劃中：Cloudflare Pages 或 static host） | `npm run build` |
| Cloudflared tunnel | `otonashikoi.org` | named tunnel |

**環境變數**：
- `MONGODB_URI` — DB 連線
- `JWT_SECRET` — JWT 簽章
- `DISCORD_BOT_TOKEN` / `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`
- `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`

---

## 9. 開發紀律

1. **資料源真相**：MongoDB 是 SoT，DC / Web 都只是顯示層。
2. **戰鬥計算**：任何屬性公式只能改 `src/shared/combatStats.js`，DC + Web 自動同步。
3. **Zone 單一來源**：用 `src/shared/zones.js`，不要 hardcode zone key。
4. **任務系統**：統一在 `weeklyQuestService`，`cadence` 包含 onboarding/job/daily/weekly。
5. **`item.id` vs `item._id`**：前者是業務 UUID，後者是 MongoDB ObjectId，不可混用。
6. **資料庫變動後**：跑 `npm run status:update` 同步 docs/CURRENT_GAME_STATUS.md。
7. **PM2 操作**：由 user 執行，AI 不主動重啟正式服務。
8. **UI 改動**：自截圖確認後再回報。

---

## 10. 路線圖（短期）

```
Phase 11 ✅ HSR 風格純 CSS 重塗 + 首頁仿 DC 我的資料
Phase 12a ⏳ 任務頁 /quests（4 cadence 分頁 + 領獎）
Phase 12b ⏳ 背包道具 use/discard/sell 接 API
Phase 12c ⏳ 裝備強化頁
Phase 12d ⏳ 交易紀錄頁（需新 API）
Phase 13  ⏳ 後端開 PK / Tower / Auction API
Phase 14  ⏳ Web 戰鬥即時動畫（SSE）
```
