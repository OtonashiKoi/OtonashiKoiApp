# 合成工房

狀態：现行實作，2026-10-04 公開配方；玩家登入仍由維護設定控制。

Web 冒險手冊的城鎮頁籤提供合成入口。已登入玩家可使用 `accessMode=public` 的啟用配方；私測配方仍要求指定測試帳號，三張舊測試配方維持停用。

公開十張配方均為五顆素材換一顆成品、必定成功，一次最多99份：寶石D→C、C→B、B→A；屬性石木→火→土→金→水→木，以及日→月、月→日。不包含S階寶石與裝備合成。

2026/10/4起每份金幣費用如下，批量合成按份數相乘：

| 配方 | 每份金幣 |
| --- | ---: |
| 寶石 D→C | 500 |
| 寶石 C→B | 2,000 |
| 寶石 B→A | 6,000 |
| 五行屬性石轉換（木→火→土→金→水→木） | 1,000 |
| 日→月、月→日 | 2,000 |

素材已採5換1，費用作為適中的金幣消耗；完全由D升至一顆A需125顆D，累積合成費28,500金幣。設定來源為MongoDB `craftingRecipes.goldCost`；`scripts/apply-crafting-fees.js` 提供預覽及備份解析驗證後套用。

## 操作與消耗保護

選配方、調份數、把素材放入鍊金爐，按攪拌後再次確認實際材料／成品／金幣。取消不消耗。確認後才呼叫 `POST /api/me/crafting/:recipeId`。

前端同步鎖避免連點，每次確認產生 `requestId`；失敗保留原確認窗與識別碼，重試沿用。後端驗證身份、維護門禁、配方資格、正整數份數、未鎖定素材、金幣及換季鍵。鎖定素材不列入可用量，也不被消耗；成品可堆疊時加入未鎖定堆疊。

請求識別碼在玩家與季度範圍內產生穩定交易ID。相同請求重送回傳既有結果；換配方或份數回409。玩家進度鎖與Mongo持久鎖防止併發覆寫。副本集用Mongo transaction；單機用 `craftingOperations` journal，背包CAS衝突先退款再重試。後續合成請求先恢復未完成journal：已入袋補齊紀錄，未入袋退回尚有扣款marker的金幣。

`GET /api/me/crafting` 回傳公開配方及當下可用數量。API仍使用共用 `requireAuth`；公開配方不解除全服維護或管理員白名單。

## 程式入口與驗收

- 服務：`src/services/crafting/craftingService.js`
- 儲存：`src/adapters/mongo/crafting/createCraftingRepository.js`、`craftingOperationJournal.js`
- API：`src/api/routes/playerCraftingRoutes.js`
- 集合：`craftingRecipes`、`craftingTransactions`、`craftingOperations`、`craftingLocks`；另使用既有 `progress`、`wallets`、`items`
- SPA：`src/routes/crafting.tsx`、`src/hooks/useCrafting.ts`、`src/components/PageShell.tsx`
- `npm run test:crafting`：配方比例、普通帳號權限、鎖定素材、整數邊界、十次併發同請求、重送、背包衝突退款／重試、扣款後與入袋後中斷恢復、實際JWT路由維護門禁。整合測試只寫隔離MongoDB。

正式環境只修改十張配方的公開旗標；不發測試素材、不對真實玩家試扣款、不解除登入維護。部署證據與核對結果記入Drive C04及開季TODO。
