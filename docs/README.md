# 文件入口與權威順序

> 狀態：現行文件治理規則。最後核對：2026-08-10。

本專案以「程式碼與目前 MongoDB 狀態」為唯一執行事實。文件的用途是讓人快速理解這個事實，不是另一套會自行漂移的規格。

## 閱讀順序

1. [README](../README.md)：怎麼啟動、驗證與找到主要入口。
2. [PROJECT_FEATURES](../PROJECT_FEATURES.md)：玩家目前能用、暫停與未實作的功能矩陣。
3. [SYSTEMS](SYSTEMS.md)：每個系統對應的程式入口與資料集合。
4. [ARCHITECTURE](ARCHITECTURE.md)：執行架構、資料流與部署邊界。
5. [CURRENT_GAME_STATUS](CURRENT_GAME_STATUS.md)：由程式碼與 MongoDB 產生的資料快照。
6. [COMBAT_FORMULA](../COMBAT_FORMULA.md)：目前共用戰鬥核心的基礎公式與結算時序。
7. [DOCUMENT_SYNC_AUDIT](DOCUMENT_SYNC_AUDIT.md)：本次找到的落差、已修項目與刻意保留的技術債。

如果上述文件彼此衝突，先執行 `npm run status:update` 與 `npm run check:docs`，再以對應的 `src/**` 程式和 MongoDB 設定為準。

## 文件分類

| 類型 | 用途 | 是否可當現況依據 |
| --- | --- | --- |
| 現行索引 | `README.md`、`PROJECT_FEATURES.md`、`docs/SYSTEMS.md`、`docs/ARCHITECTURE.md`、`COMBAT_FORMULA.md` | 可以，但仍以程式與 DB 為最終準則 |
| 生成快照 | `docs/CURRENT_GAME_STATUS.md`、`docs/EXP_TABLE.md` | 可以；需先重跑生成指令 |
| 現行細部規格 | API contract、職業與卡片規格、部署／OAuth／法務文件 | 只在標示範圍內有效；功能開關仍看現行索引與 DB |
| 提案／下季設計 | `NATIVE_GAME_ROADMAP.md`、`PHASE0_GODOT_PIXEL.md`、`SEASON_*`、`web-game-blueprint.md` | 不可以；只有已被程式實作的段落才算現況 |
| 歷史快照 | `CHANGELOG.md`、`SESSION_HANDOFF.md`、`project_review.md`、`benchmark*`、`reports/`、`balance-reports/` | 不可以；只用來追溯當時狀態 |
| 資料交換附件 | `docs/tsv/`、CSV、manifest JSON | 不一定；除非生成流程明確指定，線上資料仍以 MongoDB 為準 |

## 目前重要開關

| 項目 | 現況 | 單一來源 |
| --- | --- | --- |
| 儲存層 | MongoDB only | `src/repositories/createRepositories.js` |
| 爬塔 | 程式保留、暫停開放 | `src/bot/handlers/towerHandlers.js` 的 `TOWER_ENABLED` |
| 一轉／二轉 | 11 個一轉；13 條二轉資料；每個一轉至少 1 條可用；2 條分支鎖定（劍鬼、盜靈） | `src/shared/jobAdvancement.js` |
| 待機室預告 | YouTube 新 broadcastId 預告一次，正式開播可再公告一次 | `src/services/stream/youtubeUpcomingService.js`、`viewerEventsService.js` |
| 觀看人數提示 | 由 MongoDB `serverEventConfig.viewerTiers` 控制；同場同階一次、升階可再發、另受最短間隔限制 | `src/services/stream/streamEventConfig.js`、`streamNotificationState.js` |
| 聖人／鮮血任務 | 實際非吸血治療與實際吸血分開計算；滿血溢出不計 | `src/shared/combatLoop.js`、`weeklyQuestService.js` |

## 維護流程

功能改動完成時：

1. 更新對應現行文件，不要把新現況補進歷史報告。
2. 若變動涉及 DB 怪物、道具、任務、故事、世界王或直播活動設定，執行 `npm run status:update`。
3. 執行 `npm run check:docs`；一般程式驗證仍執行 `npm run check` 與相關測試。
4. 新規劃文件第一段必須標成「提案／未實作」；日期型報告第一段必須標成「歷史快照」。

`npm run check:docs` 會驗證幾個最容易再次漂移的硬事實：MongoDB-only、爬塔開關、一轉／二轉數量、鎖定分支，以及權威文件是否寫入相同狀態。
