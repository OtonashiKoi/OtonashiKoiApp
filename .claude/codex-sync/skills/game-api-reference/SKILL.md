---
name: game-api-reference
description: 開發新功能時查詢現有 API、Service 方法、共用工具的完整速查表。確認是否已有現成實作再動手寫。
when_to_use: 開發新遊戲功能前，確認現有 API 端點、Service 方法、MongoDB Collections、Discord 命令結構時使用。
---

# 遊戲數據 API 與工具路徑完整參考

> 本文檔用於快速查詢 API 端點、Service 層邏輯和共用工具。開發新功能時先查此表確認是否已有現成 API 或工具。

## 一、API 端點總覽

### 玩家相關
- **GET `/api/player/me`** → playerAppRoutes.js
  - 取得當前玩家資料、進度、裝備、背包、錢包
  - 傳回：`{ player, progress, wallet, combatStats, ...}`

- **POST `/api/player/attributes/reset`** → playerAppRoutes.js
  - 重置屬性點（用於屬性重製卷軸）
  - 參數：`{ targetPoints }`

- **POST `/api/player/quickBattle`** → playerAppRoutes.js
  - 快速戰鬥單怪物（用於網頁版戰鬥）
  - 參數：`{ monsterId }`

### 背包與裝備
- **POST `/api/backpack/equip`** → playerAppRoutes.js
  - 穿裝備（移出背包進入裝備槽）
  - 參數：`{ itemUuid, slot? }`

- **POST `/api/backpack/unequip`** → playerAppRoutes.js
  - 脫裝備（移出裝備槽回背包）
  - 參數：`{ slot }`

- **POST `/api/backpack/use`** → playerAppRoutes.js
  - 使用消耗品（捲軸、藥水等）
  - 參數：`{ itemUuid, quantity? }`

### 強化
- **POST `/api/enhance`** → playerAppRoutes.js
  - 強化裝備（用強化寶石）
  - 參數：`{ itemUuid }`
  - 傳回：`{ success, newLevel, message }`

### 拍賣場
- **GET `/api/auction/listings`** → playerAppRoutes.js
  - 取得公開拍賣列表（玩家查看用）
  - 參數：`{ status?, itemType?, currency?, sort?, limit?, offset? }`

- **POST `/api/auction/sell`** → playerAppRoutes.js
  - 上架商品
  - 參數：`{ itemUuid, currency, price, hours }`

- **POST `/api/auction/buy`** → playerAppRoutes.js
  - 購買商品
  - 參數：`{ auctionId }`

- **POST `/api/auction/reclaim`** → playerAppRoutes.js
  - 領回到期未售商品
  - 參數：`{ auctionId }`

### 管理後台
- **GET `/admin/auction/list`** → adminConsoleRoutes.js
  - 列出所有拍賣（支援分頁和狀態篩選）
  - 參數：`{ status?, page?, limit? }`

- **GET `/admin/auction/config`** → adminConsoleRoutes.js
  - 取得拍賣場設定（頻道、開關、可上架 Tier）

- **PUT `/admin/auction/config`** → adminConsoleRoutes.js
  - 更新拍賣場設定
  - 參數：`{ channelId?, enabled?, sellerTiers? }`

- **DELETE `/admin/auction/:id`** → adminConsoleRoutes.js
  - 強制下架商品（物品退回賣家）
  - 參數：`auctionId`

- **POST `/admin/auction/publish`** → adminConsoleRoutes.js
  - 在指定 Discord 頻道發布拍賣場面板

---

## 二、Service 層架構

### 玩家與進度
- **playerService.js**
  - `getPlayerByDiscordId(discordId)` → 取玩家資料
  - `createOrUpdatePlayer(discordId, data)` → 建立/更新玩家

- **progressService.js**
  - `getProgress(playerId)` → 取玩家進度（等級、背包、裝備）
  - `saveProgress(progress)` → 保存進度

- **walletService.js**
  - `getWallet(playerId)` → 取錢包（金幣、鑽石）
  - `addCurrency(playerId, type, amount, source)` → 增加貨幣
  - `deductCurrency(playerId, type, amount, source)` → 扣除貨幣

### 裝備與背包
- **shopService.js**
  - `equipItem(playerId, itemUuid, targetSlot?)` → 穿裝備
  - `unequipItem(playerId, slot)` → 脫裝備
  - `useItem(playerId, itemUuid, playerName)` → 使用消耗品

- **itemService.js**
  - `findById(itemId)` → 取道具定義
  - `search(query)` → 搜尋道具

### 強化系統
- **enhanceService.js**
  - `enhanceEquipment(playerId, itemUuid)` → 強化裝備（用寶石）
  - `getEnhanceInfo(playerId, itemUuid)` → 取強化資訊（需求寶石數、成功率）
  - `_countGemsInInventory(inventory, gemItemId)` → 統計背包寶石（支援堆疊）
  - `_consumeGemsFromInventory(inventory, gemItemId, count)` → 消耗寶石

### 拍賣場
- **auctionService.js**
  - `checkSellerEligibility(memberRoleIds)` → 檢查玩家是否可上架（讀 DB 設定的允許 Tier）
  - `isEnabled()` → 拍賣場是否開啟
  - `listItem({sellerId, itemUuid, currency, price, hours})` → 上架物品
  - `buyItem(buyerId, auctionId)` → 購買
  - `reclaimItem(sellerId, auctionId)` → 領回到期未售
  - `getActiveListings(filters)` → 取公開列表
  - `adminForceRemove(auctionId, adminId)` → 管理員強制下架

- **auctionRepository.js**
  - 底層 MongoDB 操作
  - `create(auction)` → 建立拍賣
  - `findById(id)` → 查單個
  - `findActive(filters)` → 查所有上架中
  - `findBySeller(sellerId)` → 查玩家的拍賣
  - `updateStatus(id, status, extra)` → 更新狀態
  - `getSettings()` / `saveSettings(settings)` → 設定存取

### 戰鬥相關
- **battleConfigService.js**
  - 怪物設定查詢

- **monsterService.js**
  - `getMonsterById(monsterId)` → 取怪物定義
  - `getMonstersByZone(zoneId)` → 取特定區域怪物

### 其他
- **weeklyQuestService.js** → 週任務
- **checkinService.js** → 簽到系統
- **playerTierService.js** → 玩家 Tier（Discord 角色驅動）
- **effectDefinitionService.js** → Buff/Debuff 定義與觸發

---

## 三、共用工具與常數

### 戰鬥計算
- **combatStats.js**
  - `calcPlayerStats(attrs, equipped, activeEffects, inventory)`
    - 計算玩家戰鬥數值（ATK、DEF、HP、迴避等）
    - 會自動呼叫 `mergeEquippedFromLibrary` 更新設計資料
    - 支援職業徽章特效
    - **重點**：强化等级自動疊加，無需手動調整

- **combatLoop.js**
  - `runCombatLoop(pStats, mCalc, mName, mHpInit, ...)` → 共用戰鬥迴圈

### 效果系統
- **effectEngine.js**
  - `mergeEquippedFromLibrary(equipped, itemRepository)` ⭐
    - **核心功能**：玩家裝備 + 道具庫設計資料動態合併
    - **重點**：`equipStats` 會自動疊加 `enhanceLevel`，保留強化加成
    - 每次計算面板/進入戰鬥都會重新計算
    - 管理員改道具庫 → 玩家下次自動生效（無需修正腳本）
  
  - `collectEquipmentEffects(equipped, trigger, context)` → 收集生效 Buff/Debuff
  - `applyEffectsToStats(baseStats, effects, context)` → 套用效果到屬性
  - `isEffectConditionMet(effect, context)` → 檢查效果觸發條件

- **effectDefinitions.js** → 所有 Buff/Debuff 定義

### 錯誤處理
- **errors.js**
  - `AppError` 類別
  - `ERROR_CODES` 常數表（PLAYER_NOT_FOUND、INVALID_ARGUMENT 等）
  - `isAppError()` 檢查

### 強化配置
- **enhanceConfig.js**
  - `ENHANCE_GEMS` → ID 對應表（D/C/B/A 階寶石 ID）
  - `ENHANCE_RULES` → 強化規則表（消耗寶石數、成功率）
  - `MAX_ENHANCE_LEVEL = 3`
  - `getGemsRequired(tier, level)` → 計算需求寶石數
  - `getSuccessRate(tier, level)` → 計算成功率
  - `validateEnhance(tier, level, owned)` → 驗證是否可強化

### 其他常數
- **sources.js** → `CURRENCY_SOURCES`、`EXP_SOURCES`（貨幣/經驗來源紀錄）
- **progression.js** → `expToNextLevel()`、`MAX_LEVEL`

---

## 四、Discord Bot 命令結構

### 命令端點 (commands.js)
```
/連線測試 → 測試連線延遲
/help → 顯示幫助
/發布玩家面板 → 發布玩家操作面板
/發布玩家查詢 → 發布玩家資訊查詢
/發布個人房間面板 → 發布房間面板
/管理員加金幣 → 增加金幣
/管理員加鑽石 → 增加鑽石
/管理員扣金幣 → 扣除金幣
/管理員扣鑽石 → 扣除鑽石
/管理員加經驗 → 增加經驗
/發布拍賣場面板 → 發布拍賣場面板
```

### 按鈕/選單路由 (commands.js 的 handleButton/handleSelectMenu/handleModal)
- `auction:*` → auctionZoneHandlers.js
- `monster-zone:*` → monsterZoneHandlers.js
- `shop:*` → coinShopHandlers.js
- `enhance_*` → playerPanel.js 的強化邏輯
- 等等...

---

## 五、MongoDB 集合結構

| 集合名 | 用途 | 主鍵 |
|--------|------|------|
| `players` | 玩家基本資料 | `_id` (discordId) |
| `progress` | 玩家進度（背包、裝備、等級） | `_id` |
| `wallets` | 玩家錢包（金幣、鑽石） | `_id` |
| `items` | 道具定義庫 | `id` (itemId) |
| `monsters` | 怪物定義 | `id` |
| `auctions` | 拍賣商品 | `id` |
| `auctionConfig` | 拍賣場設定 | `_id: "default"` |
| `transactions` | 貨幣交易紀錄 | `_id` |
| `weeklyQuests` | 週任務進度 | `_id` |

---

## 六、常見開發流程

### 新增一個遊戲功能
1. **定義 API 端點** → `src/api/routes/*.js`
2. **建立 Service 層** → `src/services/*/service.js`
3. **建立 Repository 層**（如需要資料持久化）
4. **在 createServiceContext.js 注入** Service 實例
5. **Discord 命令或按鈕處理** → `src/bot/commands.js` 或 handlers
6. **測試 API**（如有網頁版）

### 新增裝備屬性加成
1. 在 `items` collection 修改 `equipStats` 字段
2. 無需修改代碼 → `mergeEquippedFromLibrary` 會自動套用
3. 玩家下次進戰鬥自動生效

### 新增 Buff/Debuff 效果
1. 在 `effectDefinitions.js` 定義 effect 物件
2. 在 effect 的 `define` 函式實現邏輯
3. 在適當地點呼叫 `applyEffectInstances()` 套用
4. 用 `effectEngine.js` 的工具檢查觸發條件

### 新增強化規則
1. 修改 `enhanceConfig.js` 的 `ENHANCE_RULES` 表
2. 修改 `ENHANCE_GEMS` 對應表（如有新階級）
3. 其餘邏輯自動適配

---

## 七、重點設計決策

### 裝備強化與設計資料衝突的解決
**問題**：道具庫的 `equipStats` 是設計資料（管理員修改），但玩家強化後的數值也存在 `equipStats`。

**解決方案**：
- DB 存儲：玩家裝備只存 `enhanceLevel`，`equipStats` 只保留快照
- 計算時：`mergeEquippedFromLibrary()` 動態從道具庫讀基礎值，加上 `enhanceLevel`
- 好處：道具庫一改玩家自動生效，無需修正腳本；玩家強化加成永遠正確

### 寶石堆疊
- 新增寶石時自動檢查背包有沒有同 `itemId` 的
- 有 → 增加 `stackCount`
- 沒 → 新增物品，初始 `stackCount: 1`
- 消耗時優先減 `stackCount`，到 0 才刪除物品

### 拍賣場權限
- 上架資格：`sellerTiers` 存在 DB（`auctionConfig`）
- 運行時讀 `sellerTiers` 動態檢查 → `checkSellerEligibility()`
- 管理員可實時改權限，無需重啟

---

## 八、除錯技巧

### 玩家穿裝備後數值沒增加？
→ 檢查 `mergeEquippedFromLibrary()` 是否被呼叫（playerPanel.js、monsterZoneHandlers.js、playerAppRoutes.js）

### 強化後脫裝備數值變回原始？
→ 檢查 `equipItem()` 有沒有覆蓋 `equipStats`（已修好：shopService.js 第 372 行只同步 effects）

### 拍賣場設定改了但玩家看不到？
→ 檢查是否呼叫 `auctionRepository.getSettings()` 讀 DB，而非用硬編碼的常數

### 寶石消耗了但強化沒成功？
→ `_consumeGemsFromInventory()` 邏輯檢查（是否正確處理 stackCount ≤ 1）

---

## 附錄：檔案樹狀結構速查

```
src/
├── api/routes/           ← API 端點
│   ├── playerAppRoutes.js     ← 玩家相關 API
│   ├── adminConsoleRoutes.js  ← 管理後台 API
│   └── ...
├── services/             ← 業務邏輯層
│   ├── shop/shopService.js         ← 裝備/背包
│   ├── enhance/enhanceService.js   ← 強化系統
│   ├── auction/auctionService.js   ← 拍賣場
│   ├── player/playerService.js     ← 玩家
│   └── ...
├── bot/                  ← Discord Bot
│   ├── commands.js               ← 命令與路由總入口
│   ├── handlers/                 ← 各功能處理器
│   │   ├── auctionZoneHandlers.js
│   │   ├── monsterZoneHandlers.js
│   │   └── ...
│   └── playerPanel.js            ← 玩家面板
├── shared/               ← 共用工具
│   ├── combatStats.js            ← 戰鬥計算
│   ├── effectEngine.js           ← 效果系統（重要！）
│   ├── enhanceConfig.js          ← 強化規則
│   └── ...
└── adapters/
    └── mongo/createMongoClient.js ← DB 連線
```

---

**文檔版本**：2026-04-18  
**最後更新**：修復強化穿脫數值問題，增加設計資料動態合併邏輯說明

