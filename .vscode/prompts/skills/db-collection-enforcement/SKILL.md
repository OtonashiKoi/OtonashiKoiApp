---
name: db-collection-enforcement
description: 描述雲端資料庫集合的允許清單與檢查規則，並提供安全檢測指引。
---

目的：列出允許的 MongoDB collection 名稱範圍，並說明如何在 CI 或巡檢腳本中驗證。

內容要點：
- 提供建議的 `allowedCollections` 範例與說明。
- 建議只在非生產環境或授權 CI 上執行檢查（需設定 `MONGO_URL`）。
- 發現未允許的集合時，回傳詳細清單並提供建議處理步驟（如備份、移除或合併）。

範例回應：
- `status`: `ok` 或 `mismatch`
- `unexpectedCollections`: [ ... ]
