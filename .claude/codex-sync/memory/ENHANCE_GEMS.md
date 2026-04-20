---
name: 裝備強化寶石系統
description: 四階寶石ID、自動掉落機制實裝
type: reference
---

# 💎 裝備強化寶石系統

## 已建立的四階寶石

| 階級 | 寶石名稱 | ID | 說明 |
|------|---------|-----|------|
| **D階** | D階寶石 | `72fde92d-e33f-42fb-8d86-2e811d03f84d` | 用於強化D階裝備 |
| **C階** | C階寶石 | `556db9e1-b084-4b22-bab5-a66c2b586184` | 用於強化C階裝備 |
| **B階** | B階寶石 | `8fdfa7d9-f0fa-4e6a-a291-703b1e354072` | 用於強化B階裝備 |
| **A階** | A階寶石 | `a6ae293d-52fc-4af5-8770-891ddf842e35` | 用於強化A階裝備 |

## 自動掉落機制

### 實裝位置
- 檔案: `src/bot/handlers/monsterZoneHandlers.js`
- 函式: `checkAndGetEnhanceGem(progress)` (行~60)

### 觸發邏輯
1. 當任何掉落事件發生（幸運者掉落 or 人數加碼掉落）
2. 檢查該玩家身上是否有 **武器** 或 **防具** 
3. 如果有，根據最高階級品階自動贈送對應寶石
4. 稱號 (title_eq)、職業徽章 (job_eq)、特殊欄位不觸發

### 檢查邏輯
- **檢查欄位**: weapon, shield, head_top, head_mid, head_low, armor, garment, shoes, accessory_l, accessory_r
- **排除欄位**: title_eq (稱號), job_eq (職業), special_1/2/3 (特殊)
- **品階判定**: 檢查所有裝備中的 `tier` 欄位

### 數據庫位置
- Collection: `items`
- Type: `consumable`
- Database: `equipment_game`

---

**建立日期**: 2026-04-16  
**實裝日期**: 2026-04-16  
**狀態**: ✅ 已入庫 + ✅ 機制實裝
