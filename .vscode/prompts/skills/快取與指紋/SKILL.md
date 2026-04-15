**名稱**：快取與指紋

**目的**：對外部或雲端取得的文件與查詢結果建立指紋（hash/ETag）並快取，減少重複下載與重複 token 消耗。

**觸發條件**：任何從遠端 API、外部文件或大型資源抓取內容時。

**檢查規則**：
- 每次抓取先檢查本地是否有 match 的指紋（hash/etag/timestamp）。
- 若指紋未改變，使用快取回應並標示 `cache=true`、`fingerprint`、`ttl`。
- 快取條目需包含來源 URL、抓取時間、token-size-estimate 與 `audit-id`。

**拒絕策略**：若快取無法存取或已過期，才允許重新抓取；若重新抓取會產生高成本，需顯示估計 token 成本並獲得確認。

**稽核**：紀錄快取命中/未命中次數、fingerprint 與使用者/agent 的 `audit-id`。

**實作注意**：快取壽命與大小可配置；JS 範例請提供檢查 fingerprint 與返回快取回應的 minimal 範例（≤400 行），Discord 回應要顯示 `cache` 標記與快速「強制重新抓取」按鈕。