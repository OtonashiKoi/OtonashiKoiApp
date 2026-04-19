---
name: mongodb-standard
description: 任何涉及 MongoDB 操作時使用——統一儲存層標準、Repository 新增步驟、Collection 規範、索引策略。
when_to_use: 新增 Collection、設計 Repository、執行批量操作、查詢優化、或需要確認 MongoDB 標準規範時使用。
---

# MongoDB 儲存層標準化

## 概述

裝備遊戲平台已**統一採用 MongoDB 作為唯一儲存層**。所有環境必須使用 MongoDB，不再支援 JSON 檔案儲存。

---

## 核心決策

| 項目 | 決策 |
|------|------|
| **儲存方案** | ✅ MongoDB 唯一標準 |
| **開發環境** | 本機 MongoDB Community / Docker / MongoDB Atlas |
| **正式環境** | MongoDB Atlas 或自管理 MongoDB 伺服器 |
| **JSON 支援** | ❌ 已移除 |
| **環境變數開關** | ❌ 無（硬性使用 MongoDB） |

---

## 快速開始

### 1. 設定環境變數（`.env`）

**本機開發**：
```env
MONGODB_URI=mongodb://localhost:27017/equipment_game
MONGODB_DB_NAME=equipment_game
```

**雲端（MongoDB Atlas）**：
```env
MONGODB_URI=mongodb+srv://user:password@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB_NAME=equipment_game
```

### 2. 啟動 MongoDB

**Docker**（推薦）：
```bash
docker run -d -p 27017:27017 mongo:latest
```

**本機**（macOS）：
```bash
brew install mongodb-community
brew services start mongodb-community
```

### 3. 驗證連線

```bash
npm start
# 若看到 "[API] listening on port 5566" 表示成功
```

---

## 架構概覽

```
┌─────────────────────────────────┐
│  Discord Bot / REST API         │
├─────────────────────────────────┤
│  Services（業務邏輯）            │
├─────────────────────────────────┤
│  Repositories（資料存取介面）    │
├─────────────────────────────────┤
│  MongoDB Adapters               │
│  src/adapters/mongo/            │
├─────────────────────────────────┤
│  MongoDB 資料庫                  │
└─────────────────────────────────┘
```

### 關鍵檔案

- **連線與索引**：`src/adapters/mongo/createMongoClient.js`
- **Repository 工廠**：`src/adapters/mongo/createMongoRepositories.js`
- **統一入口**：`src/repositories/createRepositories.js`
- **環境設定**：`src/config.js`

---

## 常見任務

### 新增 Repository

**步驟**：
1. 在 `src/adapters/mongo/createMongoRepositories.js` 中新增 collection 操作
2. 在同檔案的 `ensureIndexes()` 中為新欄位建立索引
3. 在 Service 層透過 `createRepositories()` 使用

**範例**：
```javascript
// src/adapters/mongo/createMongoRepositories.js
myRepository: {
  async findById(id) {
    return (await collection("myCollection")).findOne({ _id: id });
  }
}

// Service 層
const repos = await createRepositories();
const item = await repos.myRepository.findById(id);
```

### 查詢集合統計

```javascript
const db = await getMongoDb();
const count = await db.collection("players").countDocuments();
```

### 批量操作

```javascript
const ops = players.map(p => ({
  updateOne: {
    filter: { discordId: p.discordId },
    update: { $set: p },
    upsert: true
  }
}));
await db.collection("players").bulkWrite(ops);
```

---

## Collections 參考

| Collection | 主要內容 | 主鍵 |
|-----------|---------|------|
| `players` | 玩家基本資料（名稱、等級等） | `discordId` |
| `wallets` | 金幣/鑽石錢包 | `playerId` |
| `progress` | EXP、技能點數等 | `playerId` |
| `transactions` | 所有金幣/鑽石交易記錄 | `_id` (自動) |
| `items` | 遊戲道具定義 | `id` |
| `monsters` | 怪物定義與數值 | `id` |
| `accessControl` | 權限清單（全域） | `_id: "default"` |
| `channelLayout` | Discord 頻道綁定設定 | `_id: "default"` |
| `adminActionLogs` | 管理員操作記錄 | `_id` (自動) |

---

## 環境遷移檢查表

部署至新環境前確認：

- [ ] `MONGODB_URI` 已正確設定
- [ ] `MONGODB_DB_NAME` 已設定（預設 `equipment_game`）
- [ ] MongoDB 伺服器可達（ping 或連線測試）
- [ ] 應用啟動成功，無連線錯誤
- [ ] 所有 collections 與 indexes 已自動建立
- [ ] 資料備份策略已就位
- [ ] 團隊成員已知悉 JSON 支援已移除

---

## 常見問題

**Q: 能在開發時用 JSON 嗎？**  
A: 否。統一 MongoDB 的目的就是確保一致性與安全性（PM2 多進程環境）。使用免費的 Docker 或 MongoDB Atlas 即可。

**Q: 舊 JSON 資料怎麼辦？**  
A: 參考 `scripts/migrate-to-mongo.js`（遺留腳本供參考），手動或自動遷移資料至 MongoDB。

**Q: 如何備份？**  
A: 
- **MongoDB Atlas**：內建自動備份
- **自管理**：使用 `mongodump` 或定期快照

**Q: 效能調優？**  
A: 監控已設定的索引，使用 MongoDB Compass 分析慢查詢，必要時調整索引策略。

---

## 相關文檔

- [MongoDB 完整指南](../../docs/MONGODB_STANDARDIZATION.md)
- [環境設定範本](../../.env.example)
- [架構總覽](../../project_review.md)

---

## 更新記錄

| 日期 | 變更 |
|------|------|
| 2026-04-15 | 統一 MongoDB，確定為唯一儲存層 |
| 2026-04-15 | 移除所有 JSON adapter 與環境變數開關 |
