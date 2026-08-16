# 程式碼與設計文件同步審計（歷史快照）

> 審計日期：2026-08-10。狀態：歷史快照，不代表目前待辦或即時資料；現況請回到 `docs/README.md` 所列權威來源。

## 審計範圍

本次以目前工作區的執行程式、設定、資料種子與 MongoDB 現況為準，檢查主要玩家功能、Discord、API、戰鬥、職業、任務、直播、世界王、管理後台與部署文件。

- `src/`：247 個 JavaScript 檔，其中 API routes 25、services 72、shared 55、bot 36。
- `scripts/`：457 個 JavaScript 檔，包含資料種子、移轉、維運、模擬與驗證工具。
- `docs/`：70 份 Markdown（含本次新增的入口、審計與報告目錄說明），另有 TSV／CSV／JSON 資料附件。
- MongoDB：用只讀查詢取得怪物、道具、任務、職業、故事、世界王與直播活動設定，結果寫入 [CURRENT_GAME_STATUS](CURRENT_GAME_STATUS.md)。
- `archive/**`：依專案規則排除，未拿來判定現況。
- `.claude/worktrees/**`、`node_modules/**`、玩家 SPA build 產物：屬副本、依賴或產物，不當作本 repository 的設計來源。

## 已修正的主要不一致

| 主題 | 舊文件或種子的問題 | 對齊後現況 |
| --- | --- | --- |
| 儲存層 | 仍描述 JSON／MongoDB 可切換或 Mongo 尚未實裝 | runtime 僅使用 MongoDB；JSON 只作種子、匯出、備份或歷史資料 |
| 專案階段 | README／架構仍像早期 MVP 或未完成骨架 | 改成目前 Discord + API + Web + 後台共用服務的實際架構 |
| 爬塔 | 部分文件把爬塔列為玩家可用 | 程式保留但總開關關閉；Discord 與 API 都擋住 |
| 職業 | 文件仍寫二轉未設計、只有少數職業或賭徒未開 | 11 個一轉皆有可用二轉；13 條分支中 11 條開放、劍鬼與盜靈 2 條鎖定 |
| 賭徒種子 | 線上 DB 已開放，但預設職業任務種子仍是停用 | 種子改為啟用，避免新環境或重建時退回舊狀態 |
| 治療任務 | 舊描述混用治療、吸血或只看顯示值 | 實際治療與實際吸血分開，溢出與被阻擋數字不累計 |
| HP 公式旁路 | 基礎戰鬥已是 `VIT×25+200`，但 VIT Buff 與後台計算器仍用舊係數 | 全部統一為每點 VIT 25 HP、基底 200，並加入自動檢查 |
| 系統驗證腳本 | 仍只驗證 10 個一轉，且期待未達等級的職業任務顯示為鎖定 | 納入賭徒成為 11 職業；低等任務依現行服務規則完全隱藏 |
| 直播通知 | 缺少待機室、開台二次通知、去重與觀看人數節流 | 補上 broadcastId 預告一次、開播再一次，以及同場／跨場冷卻規則 |
| 世界王 | 索引只列早期王 | 現行索引列出大史王、古龍王、地獄狼牙王、島島龜王四套服務 |
| 快照工具 | 產生文件時會走 runtime Mongo 初始化 | 改為直接只讀連線，不建立索引或執行舊資料移轉 |

## 文件層級

- 現況入口：[README](../README.md)、[PROJECT_FEATURES](../PROJECT_FEATURES.md)、[SYSTEMS](SYSTEMS.md)、[ARCHITECTURE](ARCHITECTURE.md)、[COMBAT_FORMULA](../COMBAT_FORMULA.md)。
- 資料現況：[CURRENT_GAME_STATUS](CURRENT_GAME_STATUS.md)，每次以 `npm run status:update` 重建。
- 細部文件：只對自身明列的範圍負責；遇到功能開關與資料數量仍回到現況入口。
- 提案與下季計畫：不能拿來宣稱已實作。
- changelog、handoff、benchmark、日期報告：只代表產生當時，不是現在。

完整閱讀規則見 [文件入口](README.md)。

## 有意保留、尚未變成現行功能的內容

- 爬塔程式與規則仍保留，但目前暫停；本次沒有刪除。
- 劍鬼、盜靈已有分支資料但本季鎖定；不是缺少二轉。
- Godot／原生遊戲、5v5 戰棋等仍是提案，沒有因文件存在而列為已完成。
- 轉職劇情稿是內容草案；MongoDB 中的實際章節與開關才是線上故事現況。

## 仍需另案處理的技術債

- MongoDB 的 `streamAccountBindings` 既有 `discordId_1_platform_1` 索引不是 unique，但 runtime 目前要求同名 unique 索引；啟動會警告。要修正需先查重並重建索引，本次不直接動正式資料庫結構。
- `monster_zone_hard` 與 `monster_zone_wasteland_throne` 仍留在停用中的頻道 binding，其中 hard 也仍在後台功能清單，但兩者都不在 `ZONE_DEFS`；現行區域是 `ancient_city`／`ancient_city_deep` 等 15 個定義。依移除政策，本次保留，不能當成有效區域。
- Discord 的 daily／weekly quest 面板 binding 目前停用或未指定頻道；Web 任務仍可用。這是部署配置，不是任務服務未完成。
- `npm run check:lines` 顯示多個既有大型檔超過其舊行數預算。這需要獨立重構工程；本次沒有放寬預算或假裝通過。

## 防止再次漂移

1. `npm run status:update` 以只讀方式重建 MongoDB 現況快照。
2. `npm run check:docs` 由程式反查 MongoDB-only、爬塔開關、一轉／二轉與鎖定數量。
3. `npm run check` 已包含文件一致性檢查。
4. `AGENTS.md` 要求日後先讀 `docs/README.md`，提案與歷史文件不得用來證明現況。
