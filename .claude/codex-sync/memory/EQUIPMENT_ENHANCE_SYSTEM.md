---
name: 裝備強化系統實裝
description: 完整強化機制、API、配置規則
type: reference
---

# ⚡ 裝備強化系統實裝完成

## 強化規則

### 各階級強化成本與成功率

| 目標等級 | D階 | C階 | B階 | A階 |
|---------|-----|-----|-----|-----|
| **+1** | 寶石2顆 + 金幣? / 100% | 寶石2顆 / 100% | 寶石2顆 / 100% | 寶石2顆 / 100% |
| **+2** | 寶石5顆 / 80% | 寶石5顆 / 80% | 寶石5顆 / 80% | 寶石5顆 / 80% |
| **+3** | 寶石15顆 / 60% | 寶石15顆 / 60% | 寶石15顆 / 60% | 寶石15顆 / 60% |

**上限**: 所有階級最高 +3

## 代碼位置

### 配置檔案
```
src/shared/enhanceConfig.js
```
- `ENHANCE_GEMS` - 寶石ID對應表
- `ENHANCE_RULES` - 各階級的強化規則
- `MAX_ENHANCE_LEVEL` - 最大強化等級（3）
- 輔助函式: `getGemsRequired()`, `getSuccessRate()`, `validateEnhance()`

### 服務層
```
src/services/enhance/enhanceService.js
```
**class EnhanceService**
- `enhanceEquipment(discordId, inventoryUuid)` - 執行強化
- `getEnhanceInfo(discordId, inventoryUuid)` - 查詢強化信息
- 私有方法:
  - `_countGemsInInventory()` - 統計背包寶石數
  - `_consumeGemsFromInventory()` - 消耗寶石
  - `_getMainStat()` - 取得裝備主屬性

### API Endpoints
**檔案**: `src/api/routes/playerAppRoutes.js`

#### GET /api/player/enhance/:itemUuid
查詢某件裝備的強化信息

**Query/Header**:
- `discordId` 或 `x-player-id` header

**Response**:
```json
{
  "itemName": "精鋼弓 +2",
  "tier": "B",
  "currentLevel": 2,
  "isMaxed": false,
  "gemsRequired": 15,
  "gemsOwned": 8,
  "successRate": 60,
  "nextLevel": 3
}
```

#### POST /api/player/enhance/:itemUuid
執行強化

**Query/Header**:
- `discordId` 或 `x-player-id` header

**Response**:
```json
{
  "success": true,
  "newLevel": 3,
  "tier": "B",
  "gemsUsed": 15,
  "successRate": 60,
  "message": "✅ 強化成功！裝備升級至 +3"
}
```

## 強化流程

### 成功流程
1. 檢查玩家進度 & 背包中的裝備
2. 驗證品階有效性 (D/C/B/A)
3. 驗證是否已達上限 (+3)
4. 檢查寶石數量是否足夠
5. **消耗寶石** (從背包移除)
6. **骰出成功/失敗** (根據成功率)
7. 若成功:
   - 更新 `enhanceLevel`
   - 更新主屬性 (+1)
   - 更新顯示名稱 (e.g. "精鋼弓 +2")
8. 保存進度

### 失敗流程
- 寶石仍被消耗
- `enhanceLevel` 不變
- 返回失敗信息

## 強化寶石自動掉落

**檔案**: `src/bot/handlers/monsterZoneHandlers.js`

當怪物掉落武器/防具時:
1. 檢查幸運者/加碼玩家身上是否有該品階的武器或防具
2. 若有 → 自動贈送對應品階的寶石
3. 稱號、職業、特殊欄位 **不觸發**

---

## ServiceContext 註冊

**檔案**: `src/services/createServiceContext.js`

```javascript
const enhanceService = new EnhanceService(
  repositories.progressRepository,
  repositories.itemRepository
);
```

在返回物件中新增 `enhanceService`

---

## 強化寶石 ID

| 階級 | ID |
|------|-----|
| D | `72fde92d-e33f-42fb-8d86-2e811d03f84d` |
| C | `556db9e1-b084-4b22-bab5-a66c2b586184` |
| B | `8fdfa7d9-f0fa-4e6a-a291-703b1e354072` |
| A | `a6ae293d-52fc-4af5-8770-891ddf842e35` |

---

**實裝日期**: 2026-04-16  
**狀態**: ✅ 完整
