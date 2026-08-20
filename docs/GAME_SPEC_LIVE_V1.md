# 遊戲完整現行規格（V1）

> 版本：`v1`  
> 定稿時間：`2026-08-20`  
> 範圍：僅整理「現在可運行且程式碼與 MongoDB 可核對」的現行內容  
> 來源優先序：
> 1. 執行程式碼 (`src/**`)  
> 2. 目前 MongoDB 狀態（`docs/CURRENT_GAME_STATUS.md`）  
> 3. 文件對照 (`docs/README.md`、`PROJECT_FEATURES.md`、`docs/SYSTEMS.md`、`docs/ARCHITECTURE.md`、`COMBAT_FORMULA.md`)  

以下文件中如有矛盾，以「程式 + MongoDB」為最終準則。  
**不納入版本**：`NATIVE_GAME_ROADMAP.md`、`PHASE0_GODOT_PIXEL.md`、`SEASON_*` 等規劃/報告文件，以及 `CHANGELOG`/`reports` 類歷史材料。

---

## 1. 產品定位與部署邊界

- 本專案是「Discord + 玩家 Web 共用後端」的線上 RPG。  
- 正式服務採用 **MongoDB-only**，JSON 僅保留作為資料來源、測試或歷史參考，不能作為運行切換選項。  
- 玩家前端 React 原始碼在獨立工作區 `~/Documents/equipmentGAME-app`，本倉庫僅存部署產物 `src/web/public/app/`。  
- 專案入口以 [docs/README.md](docs/README.md) 定義，功能矩陣以 [PROJECT_FEATURES.md](../PROJECT_FEATURES.md) 釐清，系統映射以 [docs/SYSTEMS.md](docs/SYSTEMS.md) 為準。  
- `docs/CURRENT_GAME_STATUS.md` 為當下資料快照，由 `npm run status:update` 產生，避免手動修改。  

---

## 2. 運行架構（現行）

以單一 Node.js process 同時承載：

1. Discord Bot（斜線指令、互動、面板、事件監控）  
2. Express API（玩家、管理、直播、金流、SSE）  
3. 定時任務（世界王、直播、會員、維運）  
4. 共用 service context（Discord 與 API 使用同一組服務）  

核心入口與路徑（固定）：
- 啟動：`src/index.js`
- Express：`src/api/server.js`，路由位於 `src/api/routes/`
- Discord：`src/bot/client.js`、`src/bot/handlers/`
- 服務組裝：`src/services/createServiceContext.js`
- 儲存層：`src/repositories/createRepositories.js` → `src/adapters/mongo/createMongoRepositories.js`

---

## 3. 目前版本功能門控（現行開啟）

### 玩家可用
- 登入、角色、背包、換裝、戰鬥與裝備操作、寵物、任務、主線、商店、拍賣、賽季通行證、打卡、聊天/公告  
- 一般區域討伐（Discord + Web 共用 `combatLoop`）  
- 世界王（大史王、古龍王、地獄狼牙王、島島龜王）  
- 單人世界王（帳號共用日擊殺與進度）  
- 掛機、PK、賭場、麻將排隊、周邊商城  
- 管理後台（玩家帳務/權限/世界王/怪物/道具/任務/劇情/戰鬥設定/後台活動）  
- 直播整合（OneComme、觀眾預告/開台通知、斗內/會員/SC、觀看熱度）  
- API/Discord 共用世界王與單人王 KDA 算法  

### 目前暫停（但程式保留）
- 爬塔：公開入口已封（`TOWER_ENABLED = false`），保留 Discord / Web 白名單測試機制。  

### 目前測試/白名單
- YouTube OAuth 直播綁定測試版僅給指定 `streamAuth.youtubeDirectBindTestDiscordIds` 帳號開放（文件化邏輯層）。  
- 爬塔測試仍可透過白名單邏輯檢查進入。  

### 目前仍在設計/未實作（**不列入現行規格**）
- 5v5 棋格戰鬥草案、Phaser 自動站位（未採用）  
- Godot 原生化  
- 直播限定世界王、公會/固定隊伍等提案  

---

## 4. 版本化核心事實（程式可核對）

### 4.1 基礎開關（快照）
- 儲存層：MongoDB-only  
- 爬塔：暫停  
- 一轉職業：11  
- 二轉分支：13（其中 2 條鎖定：劍鬼、盜靈）  
- 區域定義：16 個  

### 4.2 玩家與內容數量（快照）
- 玩家：434  
- 進度資料：438  
- 怪物：89  
- 世界王設定：5  
- 世界王狀態：5  
- 任務：72  
- 道具：575  
- 商店商品：30  
- 故事章節：3  
- 故事 NPC：22  

> 完整快照清單（怪物、道具、任務、世界王設定/狀態）請以  
> [docs/CURRENT_GAME_STATUS.md](docs/CURRENT_GAME_STATUS.md) 為準。  

### 4.3 世界王當前啟用陣列
- `default`（大史王）
- `dragon_king`（古龍王）
- `hellfang_king`（地獄狼牙王）
- `island_turtle`（島島龜王）
- `northwind_hutao`（北風雀神・胡桃私測；目前為 `event_boss_hutao_preview`）

---

## 5. 玩家核心系統規格

## 5.1 戰鬥

1. 共用戰鬥核心：`src/shared/combatLoop.js`（Discord/Web 共用）。  
2. 戰鬥前導與回合：屬性、裝備、職業、光環、卡片效果經 `combatStats` 與 `effectEngine` 生效後，由 `combatLoop` 一次結算。  
3. Web 會以「該回合伺服器回報動畫資料」播放，不改變傷害結果。  
4. 死亡冷卻：前端實際看到死亡結算後才開始完整 **30 秒**；播放時間不吞掉懲罰。  
5. 世界王多階段以「全部部位總血」判斷，不採用單部位誤判。  
6. 依 [COMBAT_FORMULA.md](COMBAT_FORMULA.md) 套用：  
   - HP、固定減傷、百分比減傷、傷害浮動、命中/閃避/爆擊/連擊公式  
   - 武器主屬性、攻防階級、格擋、吸血與治療統計  
   - `healDone`、`lifestealDone` 僅計實際回復量（滿血溢補不算）  
7. 世界王助攻公式（A）與職業戰績（K）由戰鬥實際數據回推，不允許以描述字串二次推算。  
8. 戰鬥任務指標、徽章熟練度、通行證積分、Discord 面板刷新以背景佇列分離提交，避免阻塞玩家結算畫面。  

### 5.1.1 世界王專用規則
- 世界王機制共享同一戰鬥核心。  
- 岛島龜王四部位 key：`head/body/wings/legs`，名稱固定顯示為龜首／島背／左鰭／右鰭。  
- 海嘯詠唱：總血首次到達 70%／40% 各一次，非周期性時間觸發。  
- 開場詠唱/控制窗口、暈眩中斷、破綻、控制條（矮人長/元素師）遵守各自持續/免疫規則。  
- 世界王寶箱排名公式： `傷害 + 0.7 × 助攻當量`，只看本場實際參與戰鬥玩家。  

### 5.1.2 單人世界王
- 帳號共用日擊殺與部位進度（非每角色獨立）。  
- 開戰前檢核錯誤不扣入場費。  

## 5.2 職業與轉職

- 單一規則來源：`src/shared/jobAdvancement.js`。  
- 一轉共 11 種，二轉共 13 條分支。  
- 本季可用二轉：2/1/11?（以 `tier 2` 實際快照判定），其中 2 條分支鎖定且不開放新轉職：劍鬼、盜靈。  
- 二轉試煉條件：
  - 轉職前提：Lv.35 + 前一轉徽章 Lv.20  
  - 轉職費用：第一個 250,000，第二個 1,000,000，第三個起 3,000,000（金幣）
- 當前實際可用二轉分支以 `docs/CURRENT_GAME_STATUS.md` 的 Tier 2 Branches 與 `src/shared/jobAdvancement.js` 為準。  
- 轉職流程仍走任務／故事節點控制；同職分支互斥與 `seasonLocked` 以程式來源為主。  

## 5.3 區域討伐與怪物

- 區域系統由 `src/shared/zones.js` 管理，戰鬥與任務事件共用。  
- 難度、怪物掉落、進場費、Boss 進階邏輯以 DB/設定為準，不以設計文件的舊值為準。  
- 一般區域與世界王換怪：Web 先以快取快訊更新畫面，權威結果以伺服器回傳接續播放，避免卡住前端。  

## 5.4 任務與賽季進度

- 任務類型：`onboarding`、`job`、`daily`、`weekly`、`season`。  
- 任務狀態與規則表以 DB 為主，任務啟用停用以 `weeklyQuests`/`weeklyQuestProgress` 快照為準。  
- 生效任務判斷欄位（包含隱藏/解鎖）：`weeklyQuestService.js`。  
- 典型任務統計：
  - 每日/每週出戰、勝場、傷害、連擊、格擋等  
  - 職業試煉（基礎屬性與武器條件）  
  - 二轉試煉（`t2_transfer`）  
  - 聖人任務：`heal_done`（實際非吸血治療，滿血溢補不算）  
  - 賭神任務：`lifesteal_done`（實際吸血）  

## 5.5 經濟、背包與配裝

- 等級上限：Lv.50，超出經驗轉金幣。  
- 背包空間、裝備、收藏、道具、稱號、任務獎勵、商城與拍賣皆以 MongoDB 持久化。  
- 角色/方案系統：  
  - 非會員 1×1（方案）  
  - 鯉民 3×3  
  - 鯉長 3×5  
  - 鯉市長以上 3×7  
- API 仍會阻擋越權套用超額方案。  
- 支援：裝備上/下裝、強化、屬性鑲嵌/拆除（每件上限 3 次成功拆除，拆除次數與失敗都會扣費）、附魔、分解、出售、鎖定、批次整理。  
- 商城、周邊商城、拍賣與任務獎勵為金幣/鑽石驅動的正式通道。  

## 5.6 直播與社群整合

- OneComme 作為核心留言/事件接收。  
- 觀眾預告與正式開台通知皆使用同一套 broadcastId 去重與冷卻控制。  
- 斗內/會員/SC 與觀看桶由 `serverEventConfig` 管理：  
  - 觀看提示以 30/40/50 三階（同場每階一次，間隔 60 分鐘以上）  
  - 斗內與 SC/會員 Buff 持續到本季結束再清除  
- 觀看事件可延續至直播中，離線後按 `graceMinutes` 漸退，不做降階處理。  
- 全域 Buff 不與個別觀看桶疊加為同階遞增，採覆寫與可預測回退。  

---

## 6. 介面規格（現場可見）

- 玩家 SPA 目前統一第三版「紫藤冒險據點」界面（不提供主題切換）。  
- 桌機/行動雙端維持 9:16 戰鬥窗框架縮放策略；不再走手機倍率雙重縮放。  
- 重要行為：
  - 戰報預設展開、可收合、可瀏覽  
  - 傳統事件字幕不重複顯示逐事件短字  
  - 戰鬥特效可關閉（傷害與戰報仍完整）  
  - 玩家進戰/聊天/任務等功能在同一頁面流程下分層，不推擠 HUD 生命資訊  
  - `Web` 與 `Discord` 戰鬥視覺表現差異僅在呈現，核心規則一致  

---

## 7. 安全、權限與維運

- OAuth/JWT/管理權限與 `adminSession` 共用；正式環境要求密鑰完整。  
- 管理 API 有記錄中介層，`POST/PUT/PATCH/DELETE` 會寫入審計。  
- API 有 CORS 白名單、速率限制、SSE 例外。  
- 伺服器會標記超過 500ms 的 API 請求為 `[API SLOW]`，區分應用耗時。  
- PM2 與 Cloudflare Tunnel 為正式流量輸出方式，維持 `src/web/public/` 靜態資源服務。  
- 每季/維運相關帳密或金流密鑰不在前端持久化；密碼/敏感欄位採分域保護。  

---

## 8. 文件與驗證流程（本版維持）

- 功能變更：同步對應文檔（[PROJECT_FEATURES.md](../PROJECT_FEATURES.md)、[docs/SYSTEMS.md](docs/SYSTEMS.md)、[COMBAT_FORMULA.md](COMBAT_FORMULA.md)）  
- 資料變更：執行 `npm run status:update` 產生新快照  
- 文檔一致性：`npm run check:docs`  
- 戰鬥回歸：`npm run test:golden`  
- 直播通知與任務指標分別有對應回歸測試  

---

## 9. 本版排除清單（未納入）

- 所有未開放或未實作提案文檔（roadmap、phase 文件）  
- 日期型歷史報告、交接文件、單純歷史 benchmark、balance reports（作為背景資料）  
- 尚未啟用的環境支線功能（如已停用設計）

---

### 附：主要對照檔

- [docs/CURRENT_GAME_STATUS.md](docs/CURRENT_GAME_STATUS.md)（當下 MongoDB 快照）  
- [docs/SYSTEMS.md](docs/SYSTEMS.md)（系統入口）  
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)（執行結構）  
- [COMBAT_FORMULA.md](COMBAT_FORMULA.md)（戰鬥公式）  
- [PROJECT_FEATURES.md](../PROJECT_FEATURES.md)（玩家功能現況）  
- [docs/README.md](docs/README.md)（文件權威順序）  
- [README.md](../README.md)（啟動與指令）  
