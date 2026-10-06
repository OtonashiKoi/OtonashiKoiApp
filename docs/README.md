# 文件入口與權威順序

> 狀態：現行文件治理規則。最後核對：2026-08-16。

本專案以「程式碼與目前 MongoDB 狀態」為唯一執行事實。文件的用途是讓人快速理解這個事實，不是另一套會自行漂移的規格。

## 閱讀順序

1. [README](../README.md)：怎麼啟動、驗證與找到主要入口。
2. [GAME_SPEC_LIVE_V1](GAME_SPEC_LIVE_V1.md)：本版完整規格快照（僅收錄現行已實作內容）。
3. [PROJECT_FEATURES](../PROJECT_FEATURES.md)：玩家目前能用、暫停與未實作的功能矩陣。
4. [SYSTEMS](SYSTEMS.md)：每個系統對應的程式入口與資料集合。
5. [ARCHITECTURE](ARCHITECTURE.md)：執行架構、資料流與部署邊界。
6. [CURRENT_GAME_STATUS](CURRENT_GAME_STATUS.md)：由程式碼與 MongoDB 產生的資料快照。
7. [COMBAT_FORMULA](../COMBAT_FORMULA.md)：目前共用戰鬥核心的基礎公式與結算時序。
8. [TODO](TODO.md)：目前工程執行順序、完成條件與需要核准的操作。

如果上述文件彼此衝突，先執行 `npm run status:update` 與 `npm run check:docs`，再以對應的 `src/**` 程式和 MongoDB 設定為準。

## 10/1 開季準備

[2026/10/1 新季度開季清單](SEASON_2026_10_LAUNCH_CHECKLIST.md)：9/21 盤點、阻擋項目、待決策事項、逐項驗收與建議時程；屬提案／執行清單，不是已開服證明。

[本季玩法規格](SEASON_2026_10_GAMEPLAY_PLAN.md)：錨點暫停、一般區與舊王簡化、站位組隊區新怪與 BOSS；已定方向與待討論細節分列，尚未實裝。

## 文件分類

| 類型 | 用途 | 是否可當現況依據 |
| --- | --- | --- |
| 現行索引 | `README.md`、`PROJECT_FEATURES.md`、`docs/SYSTEMS.md`、`docs/ARCHITECTURE.md`、`COMBAT_FORMULA.md` | 可以，但仍以程式與 DB 為最終準則 |
| 生成快照 | `docs/CURRENT_GAME_STATUS.md`、`docs/EXP_TABLE.md` | 可以；需先重跑生成指令 |
| 現行細部規格 | API contract、職業與卡片規格、部署／OAuth／法務文件 | 只在標示範圍內有效；功能開關仍看現行索引與 DB |
| 提案／下季設計 | `NATIVE_GAME_ROADMAP.md`、`PHASE0_GODOT_PIXEL.md`、`SEASON_*`、`web-game-blueprint.md` | 不可以；只有已被程式實作的段落才算現況 |
| 歷史快照 | `DOCUMENT_SYNC_AUDIT.md`、`CHANGELOG.md`、`SESSION_HANDOFF.md`、`project_review.md`、`benchmark*`、`reports/`、`balance-reports/` | 不可以；只用來追溯當時狀態 |
| 資料交換附件 | `docs/tsv/`、CSV、manifest JSON | 不一定；除非生成流程明確指定，線上資料仍以 MongoDB 為準 |

## 目前重要開關

[一般區等級與收益](NORMAL_PROGRESSION.md)：現行 1–50 養成銜接、怪物 HP／EXP、入場門檻與戰鬥驗證基準。

[新手共鬥陪練](STARTER_COMPANIONS.md)：草叢至古城的八位 NPC、按等級計算的能力、缺人補位與真人獎勵隔離。

| 項目 | 現況 | 單一來源 |
| --- | --- | --- |
| 儲存層 | MongoDB only | `src/repositories/createRepositories.js` |
| 爬塔 | 程式保留、暫停開放 | `src/bot/handlers/towerHandlers.js` 的 `TOWER_ENABLED` |
| 一轉／二轉 | 11 個一轉；13 條二轉資料；每個一轉至少 1 條可用；2 條分支鎖定（劍鬼、盜靈） | `src/shared/jobAdvancement.js` |
| 待機室預告 | YouTube 新 broadcastId 預告一次，正式開播可再公告一次 | `src/services/stream/youtubeUpcomingService.js`、`viewerEventsService.js` |
| 觀看人數提示 | 由 MongoDB `serverEventConfig.viewerTiers` 控制；同場同階一次、升階可再發、另受最短間隔限制 | `src/services/stream/streamEventConfig.js`、`streamNotificationState.js` |
| 錨點任務 | 本季暫停取得、装備及效果；原試煉定義保留但不對玩家開放 | `src/shared/anchorFeature.js`、`src/shared/anchorQuestRules.js`、`weeklyQuestService.js` |

現行共用結算、單一 runtime 所有權及發布／回復流程見 [SYSTEM_HARDENING](SYSTEM_HARDENING.md)。

## 維護流程

玩家 React／TypeScript 原始碼在獨立 repository `OtonashiKoi/equipmentGAME-app`；本 repository 的 `src/web/public/app/` 只是部署成品。介面修改與測試必須在 SPA repository 完成，再部署並提交成品。

功能改動完成時：

1. 更新對應現行文件，不要把新現況補進歷史報告。
2. 若變動涉及 DB 怪物、道具、任務、故事、世界王或直播活動設定，執行 `npm run status:update`。
3. 執行 `npm run check:docs`；一般程式驗證仍執行 `npm run check` 與相關測試。
4. 新規劃文件第一段必須標成「提案／未實作」；日期型報告第一段必須標成「歷史快照」。
5. 玩家、會員、錢包、交易與直播綁定的匯出或備份只能放在 repository 外；提交前執行 `npm run check:sensitive`。

`npm run check:docs` 會驗證幾個最容易再次漂移的硬事實：MongoDB-only、爬塔開關、一轉／二轉數量、鎖定分支，以及權威文件是否寫入相同狀態。

[首發副本設計](SEASON_2026_10_DUNGEON_DESIGN.md)：站位、開打方式、五關新怪、個人獎勵及 D01–D09 清單；討論稿，尚未實作。

[組隊副本企劃 V2](SEASON_2026_10_PARTY_PLAN_V2.md)：依使用者明確玩法重寫，含站位屬性、自動戰鬥、全滅分析、骰裝及構圖；目前討論主稿，未實作，取代舊失落鑄造所提案。


## 雲端企劃與進度入口

依使用者要求，企劃及 TODO 以指定 Drive 資料夾供確認與後續修改；修改前先讀雲端內容，保留使用者的調整，每次實際執行後更新狀態、下一步、日期與驗收證據。雲端不是背景自動同步，功能事實仍以程式與 DB 為準。

- [音無樂園資料](https://drive.google.com/drive/folders/1REF5erRZzSf7V4H2CW5M9lYFSTh4I4-W)
- [組隊企劃 V2](https://docs.google.com/document/d/1fVdLjT0x92gXCIk7i8k4XSOxsG5KcdwPTq5da3CZP7g/edit)
- [10/1 開季 TODO](https://docs.google.com/spreadsheets/d/1kKGgzw8sRTvcLbfw5GIBIK9ySGtUkrGvcUKPED16WOg/edit)

[一般區經濟與經驗模型](NORMAL_ECONOMY.md)：現行升級需求、金幣、強化／出售、掛機、疲勞與驗證基準。

[合成工房](CRAFTING.md)：公開配方、Web 入口、消耗確認、請求防重與中斷恢復；全服登入維護鎖仍適用。

[赫鋼世界王三階段](STEEL_CROWN_BOSS.md)：單一本體、HP 階段、浮游兵裝與爐心過載疊招，以及正式驗證範圍。

[圖片引導介面](SCENIC_UI.md)：背包玩家頭像、商店／任務場景入口、合成素材引導、圖鑑圖片卡、寵物與世界王視覺。

[活動世界王](EVENT_WORLD_BOSSES.md)：三王管理員預覽、非致死大招、宝箱及實際養成角色討伐驗收；公開日期與輪替排程另設。

[秋季稱號與任務](AUTUMN_TITLES.md)：七個角色獨立賽季任務、領獎防重與「楓紅漸漸」裝備收益加成。
