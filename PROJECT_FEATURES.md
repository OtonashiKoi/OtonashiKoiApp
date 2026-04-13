## 專案功能總覽

簡短描述：Discord-first 的輕量遊戲平台，提供管理後台、Discord Bot 互動、戰鬥系統與可切換的儲存後端（JSON / MongoDB）。

**核心功能**
- **戰鬥系統**：玩家可在 Discord 頻道出戰→開始戰鬥（回合制模擬）→結算。依傷害佔比分配金幣、EXP、掉落，道具掉落會放入玩家背包，包含加碼幸運獎機制。
- **參戰管理**：記錄參與者名單與傷害（damageMap），擊殺後推進下一隻怪物並清空參戰資料。

**管理後台（Web）**
- `src/web/public/admin.monsters.js`：怪物管理介面，可新增/編輯怪物、設定掉落、上傳圖片、切換上場怪物。
- 道具選擇：新增分類式 modal（可設定掉落%）並保留原有搜尋 combobox，裝備呈現數值摘要與次分類過濾。

**Discord Bot（互動與通知）**
- 支援按鈕互動（出戰、開始戰鬥、刪除紀錄、玩家面板等）。
- 擊殺與掉落會 DM 給玩家並在頻道廣播（含 BOSS 通知與 group bonus）。
- 已修正 interaction 處理：採用 `deferReply()` + `editReply()` 避免超時。

**後端與 API**
- Express REST 路由包含 admin 與 player 相關 API（`src/api/routes/`）。
- 管理面板與玩家前端透過 `/admin/items`, `/admin/monsters` 等 API 讀寫資料。

**儲存層（Adapters）**
- 支援 `json`（本機檔案）與 `mongo`（MongoDB）兩種 adapter，可透過 `.env` 的 `STORAGE_DRIVER` 切換。
- JSON 實作：`src/adapters/json/jsonStore.js`；Mongo 實作：`src/adapters/mongo/createMongoRepositories.js`。

**工具與腳本**
- 匯出 / 遷移 / 修補腳本位於 `scripts/`，例如：
  - `scripts/export-monster-participants.js`（匯出參戰者）
  - `scripts/export-all-players.js`（匯出全部玩家）
  - `scripts/migrate-to-mongo.js`（遷移到 MongoDB）

**部署與注意事項**
- 若使用 Discord 交互涉及長時間 DB 查詢，確保 interaction 先 `deferReply()`，並在作業完成後 `editReply()`。
- 在多 process（PM2）環境，`claimKill` 與 `monsterState` 使用原子操作來避免雙重結算。
- 更新 bot/server 需重新啟動運行中的程序才會生效（例如 `npm run pm2:restart`）。

**驗證建議**
- 後端：啟動服務後用 Postman 或瀏覽器驗證 `/admin/monsters`、`/admin/items`。
- 前端：開啟 admin 面板測試新增怪物、上傳圖片、用 modal 選取掉落並儲存。
- Bot：在 Discord 測試出戰→開始戰鬥，檢查是否有超時、是否正確分配獎勵與廣播。

如果需要，我可以把這個檔案放到 `docs/` 並匯出為 PDF，或把內容擴充為「部署步驟 / 測試清單 / 權限設定」。

---

## Web 戰棋（自動站位）第一階段規格（MVP v1）

目標：先做出一場可完整結算的 5v5 自動戰鬥，前端為方格戰場，資料全部由目前後台雲端提供。

### 1) 資料來源規則（強制）
- 所有遊戲資料必須來自後台雲端 API：角色、武器、怪物、技能、圖片、地形。
- 不使用本地假資料、不硬編碼數值、不在前端寫死圖片路徑。
- 前端只負責渲染與互動，戰鬥所需資料透過 API 載入。

### 2) 戰場與隊伍
- 地圖：方格地圖（預設 8x6，可由後台設定）。
- 隊伍：我方 5 人、敵方 5 人。
- 站位：開戰前可在己方部署區放置；開戰後全自動。

### 3) 自動戰鬥流程
- 開始戰鬥後，依 SPD 決定行動順序。
- 每個單位回合：
  1. 選擇目標（預設：可攻擊範圍內血量最低，若無則最近目標）
  2. 移動（若需要）
  3. 施放普攻或技能
  4. 結算傷害/狀態
- 勝負條件：一方全滅即結束。

### 4) 必要數值欄位（由雲端提供）
- 單位：id、name、hp、atk、def、spd、moveRange、attackRange、critRate、critDamage。
- 技能：id、name、type、power、range、cooldown、targetRule、aoe。
- 裝備：id、name、statModifiers、skillOverrides（可選）。
- 圖片：unitSpriteUrl、skillIconUrl、weaponIconUrl。

### 5) 前端畫面最小需求
- 戰場方格、單位立繪/圖示、血條、回合順序列。
- 播放基本攻擊/受擊動畫（可先用簡單位移與閃爍）。
- 顯示戰鬥 log（誰打誰、傷害、暴擊、擊殺）。

### 6) 驗收標準（這版算完成）
- 能成功從雲端 API 取得隊伍資料與圖片。
- 能進行一場 5v5 自動戰鬥直到結算。
- 前端戰鬥過程可視化，且不依賴本地假資料。

### 7) 下一步（你說 OK 再做）
- 建立 Battle Engine 的資料介面（TypeScript types + API 對接層）。
- 接上 Phaser 戰場場景，先完成「讀雲端資料 -> 生成單位 -> 自動回合結算」。
