---
name: MongoDB 統一決策
description: 儲存層已統一為 MongoDB，移除 JSON adapter 和環境變數開關
type: project
originSessionId: a89cdaa5-8561-42fa-8945-0fc1a70ffb34
---
**決策確定日期**：2026-04-15

## 決策內容

儲存層**統一使用 MongoDB**作為唯一儲存方案。移除：
- JSON adapter 支援
- `STORAGE_DRIVER` 環境變數
- `JSON_DATA_PATH` 配置選項

## 關鍵檔案已更新

- `src/config.js` - 移除 jsonDataPath
- `.env.example` - 刪除 STORAGE_DRIVER 與 JSON_DATA_PATH
- `README.md` - 更新環境變數說明
- `PROJECT_FEATURES.md` - 更新為單一 MongoDB 說明
- `project_review.md` - 更新架構層次為 MongoDB only
- `src/adapters/mongo/createMongoClient.js` - 更新錯誤訊息

## 新增文檔

- `docs/MONGODB_STANDARDIZATION.md` - 完整設定指南（Collections、新增 Repository、遷移、備份等）
- `.claude/skills/mongodb-standard/SKILL.md` - 標準化 SKILL 文檔

## 為什麼做出此決策

1. **多進程安全**：PM2 環境下 JSON 檔案操作易競態條件，MongoDB 原子操作更安全
2. **生產就緒**：天生支援備份、複製、分散式佈署
3. **架構簡潔**：一個 adapter，減少維護成本
4. **未來擴展**：準備多伺服器部署與跨域同步

## 如何使用

### 設定環境

本機開發（Docker）：
```bash
docker run -d -p 27017:27017 mongo:latest

# .env
MONGODB_URI=mongodb://localhost:27017/equipment_game
MONGODB_DB_NAME=equipment_game
```

雲端（MongoDB Atlas）：
```bash
# 註冊免費帳號，複製連線字串
MONGODB_URI=mongodb+srv://...
MONGODB_DB_NAME=equipment_game
```

### 新增 Repository

在 `src/adapters/mongo/createMongoRepositories.js` 中新增 collection 邏輯，並在 `ensureIndexes()` 裡新增索引。

**重要**：以後儲存邏輯統一走 MongoDB，不再支援任何檔案儲存。

## 相關文檔參考

- 完整指南：`docs/MONGODB_STANDARDIZATION.md`
- SKILL 文檔：`.claude/skills/mongodb-standard/SKILL.md`
