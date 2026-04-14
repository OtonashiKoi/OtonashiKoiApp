# NPC 與地圖設定 - 可用特性與條件清單

本文檔列出目前在專案中已實作或可立即使用的 NPC / 地圖（怪物庫）相關特性、行為條件與相關檔案位置，方便後續操作或整合。

## 概要
- 將「怪物庫」視為「地圖設定（map settings）」，地圖上的 NPC 不再直接修改 NPC 模板，而以 mapping（`npcMappings`）指向已存在的 NPC 模板。
- 地圖設定中，每個怪物可有多個 `npcMappings`，每項 mapping 包含：`eventId`、`chance`、`triggerMonsterSeq`（可為 null）。

## 主要特性 / 條件（可立即使用）

- NPC 模板（通用）
  - 編輯器位置：`src/web/public/admin.monster-events.js`（路由 `/admin/monster-events`）
  - 支援：名稱、區域、觸發序號、停留時間、圖片（Cloudinary 上傳）、節點與選項、效果設定

- 地圖（怪物）上的 NPC 映射
  - 資料結構：在怪物資料加入 `npcMappings: [{ eventId, chance, triggerMonsterSeq? }]`
  - 建立/更新：透過 `MonsterService.createMonster/updateMonster` 已支援 `npcMappings` 欄位（位置：`src/services/monster/monsterService.js`）
  - 後台 UI：`src/web/public/admin.monsters.js` 已加入 NPC 映射編輯器（右側），可從 NPC 模板選取並設定 `chance` 與 `triggerMonsterSeq`。
  - 操作行為：上方 `＋ 新增 NPC` 現在會新增一張新的怪物卡（等同 `＋ 新增怪物`）並自動把所選的 NPC 映射預填到該卡底下；使用者需按該卡 `儲存` 才會送至後端。

- 選取與出場邏輯（伺服器）
  - 位置：`src/bot/handlers/monsterZoneHandlers.js`（實際決定下一隻怪物／事件）
  - 行為：每次抽樣會合併
    1. 區域內的怪物（權重 = `spawnRate`）
    2. 來自每隻怪物的 `npcMappings`（權重 = mapping 的 `chance`）
  - 若抽中 mapping（事件），會使用 mapping 指向的 NPC 模板資料（若 template 存在）來建立 `activeEvent`，並指定 pending monster（後續出場的怪物）
  - 選取備援：若總權重為 0，會 fallback 至 `pickWeightedNextMonster`（以 spawnRate 選）

- 立即重複防止（簡單冷卻）
  - 實作：`zoneLastChosen` Map 記錄每個 zone 上一次被選中的候選（type=monster|event, id）
  - 當前策略：抽樣時嘗試排除上一次被選到的候選（若排除不會使所有池子為空）

- 模擬工具（可用於驗證分布）
  - `scripts/simulate-weighted-spawns.js`（本地示例池、快速模擬）
  - `scripts/simulate-weighted-spawns-real.js`（會從 DB 載入 `monsters` 與 `monster-events` 並支援：`--zone`, `--iterations`, `--with-cooldown`, `--defeatedSeq`）
  - 其他輔助：`scripts/print-monster-events.js`, `scripts/create-sample-npc.js`, `scripts/add-test-npc-mapping.js`。

## 路由與 API（重要端點）
- GET /admin/monster-events?includeDisabled=1  → 讀取 NPC 模板
- POST /admin/monster-events  → 建立 NPC 模板（已存在）
- PUT /admin/monster-events/:id  → 更新 NPC 模板（Quick editor、picker 可用）
- GET/PUT /admin/monsters  → 讀寫怪物（含 `npcMappings` 欄位）

## 前端 UX 流程說明（常用）
1. 在「NPC 事件模板」頁建立或確認一個 NPC 模板。
2. 到「怪物管理（地圖設定）」頁：選擇分區（normal / mid），可點 `＋ 新增怪物` 或直接點 `＋ 新增 NPC`。
   - `＋ 新增 NPC`：會新增一張新怪物卡，並把你從 picker 選的 NPC 映射新增成該卡下一列（視覺），按該卡「儲存」才會寫 DB。
3. 在怪物卡上的 NPC 映射編輯器中，你可以新增多個 mapping（指定 `chance` 與 `triggerMonsterSeq`）。

## 注意事項與限制
- NPC 模板內原有的 `chance` 欄位：系統目前以 `npcMappings`（地圖層級）為主；若你之前把 `chance` 設在 template 頂層，系統不會自動把它解釋為 mapping（可選擇跑遷移腳本）。
- 冷卻目前為「立即排除上次被選」的簡單策略；若需要更複雜的冷卻（cooldown 秒數、次數限制），需新增持續紀錄（store last-chosen timestamp 或 counter）並改邏輯。
- 後端使用的 template 必須存在於 `monsterEventRepository` 中；若 mapping 指向不存在的 id，mapping 仍會出現在池中但不會產生 template 資料（會以 id 字串為名稱 fallback）。

## 建議的下一步（選項）
1. 自動儲存：按下 `＋ 新增 NPC` 後可直接將 mapping 自動寫入怪物（目前需要手動按「儲存」）。
2. 遷移腳本：把現有 NPC template 的頂層 `chance` 轉為對應 monster 的 `npcMappings`（若你希望保留原設定）。
3. 冷卻強化：實作「冷卻秒數」或「避免近期重複」的更精準策略（並在 DB 或 Redis 保留最近記錄）。

---
檔案位置（參考）:
- `src/web/public/admin.monster-events.js`
- `src/web/public/admin.monsters.js`
- `src/services/monster/monsterService.js`
- `src/bot/handlers/monsterZoneHandlers.js`
- `scripts/simulate-weighted-spawns-real.js`

如果你要我把上述其中某個選項落實（例如：1) 自動儲存 2) 寫遷移腳本 3) 實作冷卻秒數），請選一項，我會把對應步驟列入 TODO 並實作。
