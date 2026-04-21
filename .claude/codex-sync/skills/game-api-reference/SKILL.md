---
name: game-api-reference
description: 開發新功能時查詢現有 API、Service 方法、共用工具的完整速查表。確認是否已有現成實作再動手寫。
when_to_use: 開發新遊戲功能前，確認現有 API 端點、Service 方法、MongoDB Collections、Discord 命令結構時使用。
---

## 執行原則（必遵守）

1. 不做半套：功能若未形成「可用閉環」（前端入口、後端接口、實際處理、儲存/回寫、驗證）視同未完成。
2. 收尾前必檢查：回覆使用者前，必逐項確認需求清單與實作結果一致，缺任一項要先補齊或明確標註未完成與原因。
3. 不以占位交付：暫時文案、空按鈕、無 handler 的面板不得當作完成版交付。
4. 先驗證再結案：至少完成一次可執行檢查（載入、路由、關鍵流程），再回報完成。

# 遊戲 API 速查表（更新：2026-04-20）

> 開發新功能前先查此表，確認是否已有現成 API 或工具。

---

## 一、玩家 API（JWT 認証）

| Method | Path | 描述 |
|--------|------|------|
| POST | `/api/auth/discord` | Discord OAuth2 登入 + 發放 JWT |
| GET | `/api/me/profile` | 玩家檔案 + 錢包 + 進度 |
| GET | `/api/me/inventory` | 背包物品 + 裝備槽 |
| POST | `/api/me/inventory/equip/:uuid` | 裝備物品到指定槽位 |
| POST | `/api/me/inventory/unequip/:slot` | 卸下裝備 |
| POST | `/api/me/inventory/use/:uuid` | 使用消費品 |
| POST | `/api/me/inventory/discard/:uuid` | 丟棄物品 |
| POST | `/api/me/inventory/sell/:uuid` | 販售物品 |
| GET | `/api/me/enhance/:itemUuid` | 查詢強化資訊 |
| POST | `/api/me/enhance/:itemUuid` | 執行寶石強化 |
| GET | `/api/shop/items` | 列出商店商品 |
| POST | `/api/shop/buy/:itemId` | 購買商品 |
| GET | `/api/combat/zones` | 所有怪物區狀態 + 排行榜 |
| POST | `/api/combat/quick-battle` | 快速戰鬥（傳回戰鬥日誌） |
| GET | `/api/weekly-quests` | 玩家本週任務進度 |
| POST | `/api/weekly-quests/:id/claim` | 領取任務獎勵 |
| GET | `/api/chat/lobby` | 發送聊天訊息 |
| GET | `/api/chat/stream` | SSE 訊息串流 |
| GET | `/api/chat/history` | 最近 50 則聊天 |
| GET | `/api/notifications/poll` | 輪詢獎勵通知 |

### 不需 JWT
| Method | Path | 描述 |
|--------|------|------|
| GET | `/health` | 服務健康檢查 |
| GET | `/api/viewer/battle-config` | Viewer 用戰鬥設定 |
| GET | `/api/viewer/snapshot` | Viewer 用怪物區快照 |
| GET | `/api/chat/viewer-profile` | 外部平台玩家查詢 |

---

## 二、管理員 API（Token 認証）

### 怪物管理
| Method | Path | 描述 |
|--------|------|------|
| GET | `/admin/monsters` | 列出所有怪物（含停用） |
| POST | `/admin/monsters` | 新增怪物 |
| PUT | `/admin/monsters/:id` | 更新怪物 + 自動重發面板 |
| DELETE | `/admin/monsters/:id` | 刪除怪物 |
| POST | `/admin/monsters/:id/image` | 上傳怪物圖片（Cloudinary） |
| GET | `/admin/monsters/state?zone=KEY` | 怪物區狀態（HP、傷害表） |
| PUT | `/admin/monsters/state` | 更新怪物區狀態 |
| GET | `/admin/monster-cards` | 列出怪物卡片 |

### 玩家管理
| Method | Path | 描述 |
|--------|------|------|
| GET | `/admin/players/:discordId/profile` | 玩家檔案 |
| GET | `/admin/players/:discordId/wallet` | 玩家錢包 |
| GET | `/admin/players/:discordId/transactions` | 交易記錄 |
| POST | `/admin/players/:discordId/grant` | 發放金幣/鑽石 |
| POST | `/admin/players/:discordId/grant-exp` | 發放經驗 |
| POST | `/admin/players/:discordId/allocate-attribute` | 配置屬性點 |
| GET | `/admin/console/players` | 列出所有玩家 |
| GET | `/admin/console/leaderboard` | 排行榜 |
| POST | `/admin/console/players/:discordId/grant-item` | 發放物品 |

### 頻道管理
| Method | Path | 描述 |
|--------|------|------|
| GET | `/admin/console/bootstrap` | 啟動後台（頻道 + Tier + 角色資訊） |
| PUT | `/admin/channel-layout` | 更新頻道綁定 |
| POST | `/admin/channel-layout/publish-player-panel` | 發布玩家面板 |
| POST | `/admin/channel-layout/publish-monster-zone` | 發布怪物區面板 |
| POST | `/admin/channel-layout/publish-weekly-quest` | 發布每週任務 |
| POST | `/admin/channel-layout/publish-coin-shop` | 發布金幣商店 |
| POST | `/admin/channel-layout/sync-permissions` | 同步 Discord 頻道權限 |

### 拍賣場管理
| Method | Path | 描述 |
|--------|------|------|
| GET | `/admin/auction/list` | 拍賣列表（?status=&page=&limit=） |
| DELETE | `/admin/auction/:id` | 強制下架 |
| GET/PUT | `/admin/auction/config` | 拍賣場設定 |
| POST | `/admin/auction/publish` | 發布拍賣面板 |

### 物品/商店管理
| Method | Path | 描述 |
|--------|------|------|
| GET/POST | `/admin/items` | 物品庫 |
| PUT/DELETE | `/admin/items/:id` | 更新/刪除物品 |
| POST | `/admin/items/:id/image` | 上傳物品圖片 |
| GET/POST | `/admin/shop/items` | 商店物品 |
| PUT/DELETE | `/admin/shop/items/:id` | 更新/刪除商店物品 |
| GET/POST | `/admin/weekly-quests` | 每週任務定義 |
| PUT/DELETE | `/admin/weekly-quests/:id` | 更新/刪除任務 |

### 其他管理
| Method | Path | 描述 |
|--------|------|------|
| GET | `/admin/audit-logs` | 審計日誌 |
| GET/PUT | `/admin/player-tiers` | Tier 設定 |
| GET/PUT | `/admin/battle-config` | 戰鬥設定 |
| GET/PUT | `/admin/effect-modules` | 效果模組 |
| GET/PUT | `/admin/animation-studio/templates` | 動畫模板 |
| GET/PUT | `/admin/access-control` | 存取控制 |

---

## 三、Service 層主要方法

### PlayerService
```js
ensurePlayer(discordId, displayName)      // 確保玩家記錄存在
getProfile(discordId, displayName)         // 取得完整檔案
```

### RewardService
```js
grantCurrency({ discordId, displayName, currencyType, amount, source, operator })
// currencyType: "gold" | "diamond"，amount 負數 = 扣除
```

### ProgressService
```js
grantExp({ discordId, displayName, amount, source })   // 發放 EXP，自動升級
allocateAttribute({ discordId, attribute, amount })     // 使用狀態點配置屬性
```

### MonsterService
```js
listMonsters({ includeDisabled, zone })   // 含計算後 calc: {maxHp, atk, def, ...}
createMonster(fields)
updateMonster(id, fields)                 // 自動重發 Discord 面板
getState(zoneKey) / saveState(state, zoneKey)
```

### ShopService
```js
purchase(discordId, displayName, itemId, memberRoleIds)  // 購買（含 Tier 檢查）
equipItem / unequipItem / useItem / discardItem / sellItem
enhanceItem(discordId, targetUuid, materialUuid)         // 合成強化
updatePlayerTier(discordId, memberRoleIds)               // 同步 Tier
```

### EnhanceService
```js
getEnhanceInfo(discordId, itemUuid)   // 查詢強化資訊（所需寶石、成功率）
enhanceEquipment(discordId, itemUuid) // 執行寶石強化
```

### WeeklyQuestService
```js
listQuests() / createQuest(fields) / updateQuest(id, fields)
getPlayerProgress(discordId, weekLabel?)
recordProgress(discordId, questType, amount)  // 由 monsterZoneHandlers 呼叫
claimReward(discordId, questId)
// questType: "battle_count" | "battle_win" | "damage_total" | "checkin_count"
```

### AuctionService
```js
listItem({ sellerId, itemUuid, currency, price, hours })  // hours: 1|6|12|24
buyNow(buyerId, auctionId)
placeBid(bidderId, auctionId, bidAmount)
finishAuction(auctionId)
adminForceRemove(auctionId, operator)
```

### AdminConsoleService
```js
getChannelLayout() / setChannelLayout(bindings)
publishPlayerPanel(channelId)
publishMonsterZonePanel(channelId, activeMonster, currentHp, stats)
publishWeeklyQuestPanel(channelId)
listAllPlayers(limit) / getLeaderboard(limit)
```

### AdminService
```js
grantCurrencyByAdmin({ adminId, targetDiscordId, displayName, currencyType, amount, reason })
grantExpByAdmin({ adminId, targetDiscordId, displayName, amount, reason })
listRecentAuditLogs(limit)
```

### PlayerTierService
```js
getTiers() / saveTiers(tiers)
resolveHighestTier(memberRoleIds)   // 從 Discord Role 解析最高 Tier
```

---

## 四、MongoDB Collections

| Collection | 主鍵 | 主要欄位 |
|------------|------|---------|
| `players` | `discordId` | discordId, displayName |
| `wallets` | `playerId` | gold, diamond |
| `progress` | `playerId` | level, exp, equipment, inventory, attributes, activeEffects |
| `transactions` | auto | playerId, currencyType, amount, source, balanceAfter |
| `items` | `id` (UUID) | name, itemType, effect, equipSlot, tier, imageUrl |
| `shopItems` | `id` | itemLibraryId, price, currency, stock, enabled, allowedTiers |
| `monsters` | `id` | name, seq, zone, stats(str/agi/vit/int/dex/luk), effects, drops |
| `checkins` | auto | playerId, timestamp, streakDays |
| `auctions` | `id` | sellerId, itemUuid, currency, price, status, expiresAt |
| `auctionConfig` | `_id:"default"` | enabled, channelId, sellerTiers |
| `adminActionLogs` | auto | adminId, action, targetId, details |

> **注意**：`item.id` 是 UUID（業務用），`item._id` 是 MongoDB hex string（不可混用）

---

## 五、Discord 指令與按鈕

### 斜杠命令
| 指令 | 類型 | 參數 |
|------|------|------|
| `/連線測試` | 全員 | - |
| `/help` | 全員 | - |
| `/發布玩家面板` | 管理員 | - |
| `/發布玩家查詢` | 管理員 | - |
| `/發布個人房間面板` | 管理員 | - |
| `/解鎖個人房間面板` | 管理員 | - |
| `/管理員加金幣` | 管理員 | 玩家、數量、原因 |
| `/管理員扣金幣` | 管理員 | 玩家、數量、原因 |
| `/管理員加鑽石` | 管理員 | 玩家、數量、原因 |
| `/管理員扣鑽石` | 管理員 | 玩家、數量、原因 |
| `/管理員加經驗` | 管理員 | 玩家、數量、原因 |
| `/發布拍賣場面板` | 管理員 | - |

### Button customId 模式
| customId | 功能 |
|----------|------|
| `player_panel:*` | 玩家面板（檔案/背包/打卡） |
| `monster-zone:enter-battle` | 進入怪物區戰鬥準備 |
| `monster-zone:start-fight` | 開始戰鬥 |
| `monster-zone:delete-log` | 刪除戰鬥紀錄 |
| `shop_*` | 金幣商店（選項/購買/確認） |
| `auction:*` | 拍賣場（上架/競標/購買） |
| `npc_event:*` | NPC 事件選項 |
| `weekly_quest_*` | 每週任務（查看/領獎） |

### Select 選單 customId
| customId | 功能 |
|----------|------|
| `shop_select` | 商店分類選單 |
| `shop_category:*` | 商品列表 |
| `auction_select:*` | 拍賣物品選單 |
| `equipment_select` | 裝備選項 |

---

## 六、Zone 系統

| Zone Key | Feature Key | 標籤 | 等級範圍 | 顏色 |
|----------|-------------|------|---------|------|
| `beginner` | `monster_zone_beginner` | 🌱 新手區 | Lv.1–3 | 0x2ecc71 |
| `normal` | `monster_zone` | ⚔️ 一般區 | Lv.1–10 | 0xe74c3c |
| `mid` | `monster_zone_mid` | ✦ 中級區 | Lv.10+ | 0x7c3aed |
| `hard` | `monster_zone_hard` | 🔥 高級區 | Lv.20+ | 0xf97316 |
| `elite` | `monster_zone_elite` | 💀 精英區 | Lv.30+ | 0xef4444 |

### zones.js 匯出函式（src/shared/zones.js）
```js
normalizeZone(zone)                                      // 非法值 fallback "normal"
zoneToFeatureKey(zoneKey) / featureKeyToZone(featureKey)
isMonsterZoneFeatureKey(featureKey)
getZoneTheme(zoneKey)                                    // { label, color, emoji, tagline }
checkZoneLevelRequirement(zoneKey, playerLevel)
checkZoneLevelRequirementWithBinding(zoneKey, playerLevel, binding)
ALL_ZONE_KEYS                                            // 全部 key 陣列
```

---

## 七、共用工具模組（src/shared/）

### effectEngine.js
```js
mergeEquippedFromLibrary(equipped, itemRepository)   // 從物品庫合併裝備資訊（含強化）
collectEquipmentEffects(equipped, triggerType, ctx)
applyEffectInstances(effects, stats)
decrementActiveEffects(effects, type, amount)
```

### combatStats.js
```js
calcPlayerStats(attrs, equipped, activeEffects, inventory)
// 回傳：{ atk, def, mdef, dodge, hit, hp, ... }
```

### combatLoop.js
```js
runCombatLoop(playerStats, monsterStats, monsterName, initialMonsterHp, durationMs, context)
// 回傳：{ outcome: "win"|"lose"|"timeout", roundLogs, totalDamage, finalMonsterHp, finalPlayerHp }
```

### progression.js
```js
const MAX_LEVEL = 40
expToNextLevel(level)   // 1-15 原公式，16-40 平滑延伸
```

### enhanceConfig.js
```js
const MAX_ENHANCE_LEVEL = 10
getGemsRequired(tier, level)   // 計算所需寶石數
getSuccessRate(tier, level)    // 計算成功率
validateEnhance(tier, level, gemsOwned)
```

### response.js
```js
ok(data, message)              // { status:"ok", code:"OK", message, data }
fail(code, message, data)      // { status:"error", code, message, data }
```

### cloudinaryUpload.js
```js
uploadImage(filePath, folder)  // 回傳 { imageUrl, imageThumbnailUrl }
```

---

## 八、Progress 資料結構參考

```js
{
  playerId: "discord-id",
  level: 15,
  exp: 5000,
  job: "Warrior",            // Warrior | Mage | Archer | Thief | Paladin | Healer | Fighter
  maxLevel: 40,
  attributes: { str, agi, vit, int, dex, luk },  // 各上限 60
  statusPoints: 3,
  playerTier: "C",
  equipment: {
    head_top, weapon, shield, job_eq, title_eq, ...
    // 每個槽：{ uuid, itemId, itemName, equipStats, enhanceLevel, weaponType, ... }
  },
  inventory: [
    { uuid, itemId, itemName, itemType, equipSlot, equipStats, tier, enhanceLevel, ... }
  ],
  activeEffects: [
    { key, params, duration, sourcePhase, ... }
  ]
}
```

---

## 九、monsterZoneHandlers.js 重要常數

```js
const MAX_ROUNDS = 15
const BATTLE_TIMEOUT_MS = 60000   // 1 分鐘未開始視為逃跑
const DEATH_COOLDOWN_MS = 25000   // 死亡冷卻 25 秒
const RARE_TIERS = new Set(["A", "S", "SS", "SSR", "UR"])
```

主要函式：
```js
handleMonsterZoneButton(interaction)      // 所有怪物區按鈕
handleMonsterKill({ discordId, displayName, session, monster, state, totalDamage, zoneKey })
_republishPanel(serviceContext, zoneKey, monster, hp, participantCount, damageMap)
_broadcastBossSpawn(serviceContext, zone, monster)
```

---

## 十、常用操作流程速查

### 戰鬥完整流程
1. `monster-zone:enter-battle` → 準備畫面
2. `monster-zone:start-fight` → `runCombatLoop()`
3. 勝利 → `handleMonsterKill()` → 獎勵+掉落
4. `_republishPanel()` 更新 HP 面板

### 購買流程
1. `POST /api/shop/buy/:itemId`
2. `ShopService.purchase()` 檢查 Tier & 庫存
3. `RewardService.grantCurrency(負數)` 扣款
4. `progressRepository.save()` 加入背包

### 任務完成流程
1. 玩家行動 → `WeeklyQuestService.recordProgress()`
2. `POST /api/weekly-quests/:id/claim`
3. `WeeklyQuestService.claimReward()` 發獎

### 發布面板流程
1. 後台設定頻道綁定 `PUT /admin/channel-layout`
2. `POST /admin/channel-layout/publish-monster-zone`
3. `AdminConsoleService.publishMonsterZonePanel()`
