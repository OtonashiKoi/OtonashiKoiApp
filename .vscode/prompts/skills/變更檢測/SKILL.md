**名稱**：變更檢測

**目的**：僅在來源內容確實改變時（ETag/last-modified/hash）才重新抓取全文，避免不必要的重抓與 token 消耗。

**觸發條件**：任何預定要重新抓取外部文件或 API 資料時。

**檢查規則**：
- 優先使用 ETag 或 last-modified；若無則計算內容 hash 比對本地 fingerprint。
- 若來源未變更，直接回傳已保存的摘要/快取，並標示 `unchanged=true`。

**拒絕策略**：若檢測元資料不可用且預估抓取成本高，回應提示並要求使用者確認或指定範圍。

**稽核**：記錄每次檢測結果、來源 metadata 與 `audit-id`。

**實作注意**：示例 JS 展示 ETag 檢查流程與 fallback hash 比對（≤400 行），回應優先在 Discord 中說明是否命中變更檢測。