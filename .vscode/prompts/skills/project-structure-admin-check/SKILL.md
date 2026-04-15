---
name: project-structure-admin-check
description: 說明並檢查專案架構、後台服務與管理介面，提供巡查項目與修復建議。
---

目的：提供一個可由 Agent 使用的檢查表，快速瞭解專案目錄、後台服務、管理介面與雲端資源。

檢查項目：
- 專案主要資料夾（`src/`, `scripts/`, `player-web/`）是否齊全。
- 後台服務入口（如 AdminService、createServiceContext）是否存在且可定位。
- 靜態資源與雲端媒體設定（例如 Cloudinary）是否有說明與範例。
- 與 DB 的連線設定（`MONGO_URL`）有無範例與注意事項。

使用方式：Agent 在啟動時可逐項回報狀態，並給出修復建議或需要開發者確認的變更清單。

限制：此 SKILL 僅為檢查與建議，不會直接修改程式碼或資料庫。
