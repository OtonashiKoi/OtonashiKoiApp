# 工程 TODO

> 狀態：執行清單。最後更新：2026-08-16。
>
> 只安排會影響玩家、發布可靠性或資料安全的工作。程式碼與目前 MongoDB 才是執行事實；純重構不自動升級成當前阻擋。

## 現在做

- [ ] **收攏玩家 SPA 正式原始碼**
  - 來源 repository：`OtonashiKoi/equipmentGAME-app`；本 repository 只保存 `src/web/public/app/` 部署成品。
  - 先備份並提交目前線上版本對應的未提交原始碼，再將功能分支快轉到 SPA `master`。
  - 完成條件：SPA source、線上 bundle 與兩個 repository 的 commit 可互相追溯。

- [ ] **修補直接暴露面的依賴安全問題**
  - 後端先處理檔案上傳、Discord HTTP client；SPA 先處理 Axios 與建置工具。
  - `sharp` 跨 breaking version，獨立備份並驗證圖片上傳、縮圖與 Discord 裝備卡。
  - 完成條件：`npm audit` 的可修高風險項目已處理，兩個 repository 的品質門檻通過。

## 接著做

- [ ] **修正 `streamAccountBindings` 正規化重複資料**（正式 DB 變更，需核准）
  - 先備份相關文件，再保留資訊完整紀錄、處理別名重複並重建符合 runtime 的唯一索引。
  - 完成條件：會員／訂閱者快照未遺失，啟動不再出現索引衝突警告。

- [ ] **建立 SPA 的 GitHub Actions 品質門檻**
  - 先建立現有 lint 債務 baseline；新變更不得增加錯誤。
  - 至少執行 TypeScript、build 與正式戰鬥 UI 回歸測試。

## 觸發時才做

- 大型檔案只在下一功能會修改該區時拆分，保留現有行數 ratchet。
- 爬塔擴大測試前，再補房間重啟復原與 `runId` 冪等結算。
- Golden snapshot 只有確認平衡規則刻意改變時才能更新。

## 每批固定品質門檻

1. 變更前備份受影響檔案；DB 操作另做資料備份。
2. 跑功能對應測試與 `npm run check:sensitive`。
3. 跑 `npm run test:all`；目前標準為 10/10 通過。
4. 跑 `git diff --check`，只 stage 已確認範圍。
5. 必要時執行 `npm run status:update` 與 `npm run check:docs`。
6. commit、push，確認本地與遠端 ahead/behind 為 0/0。

## 已完成

- [x] 將後端正式穩定版本收進 `master`，並清理已合併功能分支。
- [x] 建立固定 fixture 的戰鬥 golden test 與大型檔案成長 ratchet。
- [x] `npm run test:all` 擴充為 10 組並能自然結束。
- [x] 公開 repository 改用離線 CI，不再引用不存在的 `player-web/`。
- [x] 阻止 `exports/`、BSON、會員／玩家備份與生成暫存檔再次進入 Git。
