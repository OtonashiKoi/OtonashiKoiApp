# 新系統索引（V1）

> 本文件覆蓋 2026-04 之後加入的系統，舊規格文件未補完前以此為準。
> 設計細節仍建議直接讀對應程式檔；本文件提供「在哪裡找什麼」的入口。

最後更新：2026-05-21（commit `91fe38a` / `b50b639` 之後）

---

## PK 對戰系統

**入口**
- Discord 互動：`src/bot/handlers/pkArenaHandlers.js`（1548 行）
- 戰鬥核心：`src/shared/pkCombat.js`（1379 行；匯出 `runPkCombat`）
- 視圖：`src/bot/pkArenaView.js`

**特性**
- 完整職業效果移植（PK 場景下重算各職業 buff/debuff）
- 矮人暈眩強化、法杖防禦穿透
- 雙持副手繼承暈眩 / 破防觸發
- 下注系統（最近修正了下注選單索引錯誤）
- 第一名易主公告，廣播頻道 `1450062298076151952`

**設計規格**：`game_content_master_spec_v1.md` §16

---

## 爬塔系統（Tower）

**入口**
- Discord 互動：`src/bot/handlers/towerHandlers.js`（2014 行）
- 視圖：`src/bot/towerView.js`
- 設計檢查清單：`docs/TOWER_PARTY_BATTLE_V1_CHECKLIST.md`
- Benchmark：`scripts/benchmark_tower.js`、`scripts/benchmark_tower_v2.js`

**特性**
- 多層挑戰；結算條件：行動格耗盡 / 全員陣亡
- 每層通關後廣播到指定頻道（僅刷新全服最高層紀錄時觸發）
- 攻塔結算 DM 顯示終止原因、怪物剩餘血量、祝福效果說明
- 爬塔專用消耗品：回復藥水（小/中/大）、復活藥水（小/大）

**爬塔組隊戰 V1**：見 `TOWER_PARTY_BATTLE_V1_CHECKLIST.md`，新增 `party_agi_up` 等隊伍級效果

---

## 世界王（World Boss）

**入口**
- Service：`src/services/worldBoss/worldBossService.js`（233 行，`class WorldBossService`）
- MongoDB Collection：`worldBossConfig`、`worldBossState`

**特性**
- 週循環機制（台灣時區，`getTWParts` / `currentWeekLabelTW`）
- 多階段配置（`normalizePhaseList`）
- 預設狀態：`defaultStateForWeek(weekKey)`

**待補規格**：尚無獨立設計文件，需直接讀 `worldBossService.js` 或 `worldBossConfig` collection schema。

---

## 賭鬼強化（Gamble Enhance）

**入口**
- Service：`src/services/enhance/enhanceService.js`（`EnhanceService`，匯出常數 `ENHANCE_MODES = { NORMAL, GAMBLE }`）
- API：`POST /api/me/enhance/:itemUuid`（`src/api/routes/playerAppRoutes.js:1807`）
- Admin：`src/web/public/admin.effects.js`

**規則**
- `GAMBLE_MIN_ENHANCE_LEVEL = 1`：裝備至少 +1 才能使用賭鬼模式
- 不符條件回 `INVALID_ARGUMENT` (400)，訊息：「賭鬼強化需裝備至少 +1 才能使用」

**詳細規則**：`memory/EQUIPMENT_ENHANCE_SYSTEM.md`（基礎強化）+ 本段補充

---

## 隊伍效果（Party Effects）

**新效果 key**（截至 2026-05-21）：
- `party_damage_up`、`party_boss_damage_up`、`party_monster_def_down`
- `party_agi_up`（隊伍 AGI 加成，2026-05 新增）
- `party_damage_reduction`、`party_crit_damage_reduction`
- `party_exp_gain_up`、`party_gold_gain_up`

**定義位置**
- 效果定義：`src/shared/effectDefinitions.js`
- 中文顯示：`src/shared/effectDisplayNames.js`
- Admin UI：`src/web/public/admin.effects.js`

**百分比類效果**：上述 8 個 party 效果都在 `PERCENT_EFFECT_KEYS` 集合內，admin 輸入 `1.1` 會自動換算成 `+10%`。

---

## 命中率系統（Hit Chance）

**入口**：`src/shared/hitChance.js`（17 行，小工具）
- PK 戰鬥與 PvE 共用命中計算的單一來源。

---

## 待補的設計規格

下列系統目前**只有程式碼**，沒有獨立設計文件，建議優先補：

| 系統 | 程式入口 | 文件狀態 |
| --- | --- | --- |
| 世界王完整週循環設計 | `worldBossService.js` | ❌ 缺 |
| 爬塔結算分數 / 排行榜公式 | `towerHandlers.js` | 部分在 V1 checklist |
| PK 下注賠率 / 結算 | `pkArenaHandlers.js` | 缺 |
| 賭鬼強化機率表 | `enhanceService.js` | 缺（在程式內常數） |

---

## 跟舊文件的對應關係

- `API_CONTRACT_V1.md` / `_CORE10.md`：**未涵蓋** gamble 模式、tower 端點、party 端點
- `MONSTER_CORE_V1_PIPELINE.md`：**未涵蓋** boss 特殊行為（世界王 / 爬塔 boss）
- `game_content_master_spec_v1.md` §16：**已涵蓋** PK 系統，仍是 PK 的最佳參考
