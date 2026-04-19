---
name: performance-optimization
description: Discord Bot + API + MongoDB 效能下降時使用——監控工具、瓶頸診斷、PM2 競態條件、記憶體洩漏偵測、索引優化。
when_to_use: API 響應變慢、Discord 互動超時、MongoDB 查詢效能下降、PM2 進程記憶體持續增長時使用。
---

# 效能分析與優化

## 概述

這個 SKILL 涵蓋如何在 **Discord Bot + Express API + MongoDB + PM2** 環境中診斷和優化效能瓶頸。

---

## 1. 監控工具與指標

### Discord Bot 效能

**關鍵指標**：
- **Latency** - Bot 與 Discord 的往返時間（`/連線測試` 命令）
- **Interaction Response Time** - 按鈕點擊到回應的時間
- **Memory Usage** - Node.js 進程記憶體佔用

**監控方法**：
```javascript
// bot/client.js 中新增效能指標
client.on('interactionCreate', async (interaction) => {
  const startTime = Date.now();
  
  try {
    await handleInteraction(interaction);
  } finally {
    const duration = Date.now() - startTime;
    if (duration > 3000) {
      console.warn(`[PERF] 互動耗時 ${duration}ms: ${interaction.customId}`);
    }
  }
});
```

### API 效能

**Express 中間件**：
```javascript
// api/middleware/timing.js
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 500) {
      console.warn(`[PERF] ${req.method} ${req.path} took ${duration}ms`);
    }
  });
  next();
});
```

**API 端點優化清單**：
- `GET /admin/monsters` - 查詢所有怪物（常呼叫）
- `POST /admin/players/:id/grant` - 交易邏輯（需原子性）
- `GET /admin/players/:id/transactions` - 分頁查詢

### MongoDB 效能

**索引檢查**：
```javascript
// 查看現有索引
db.collection('players').getIndexes()

// 分析查詢性能
db.collection('players').explain('executionStats').find({ discordId: '...' })
```

**常見瓶頸**：
- `players.findOne({ discordId })` - 已索引 ✅
- `transactions.find({ playerId }).sort({ createdAt: -1 }).limit(10)` - 需複合索引
- `wallets.findOne({ playerId })` - 已索引 ✅

---

## 2. PM2 多進程環境下的瓶頸

### 競態條件診斷

**問題**：`claimKill`、`monsterState` 在多進程環境可能雙重結算

**診斷**：
```bash
# 監控進程
npm run pm2:status

# 查看詳細日誌
npm run pm2:logs

# 檢查是否有重複更新
# 在日誌中搜尋 "claim" 或 "winner"，看是否同一隻怪物出現多次
```

**解決方案**：
- 使用 MongoDB `findOneAndUpdate` 的原子操作
- 在 Service 層加入樂觀鎖（版本號）
- 記錄所有 claim 嘗試到 audit log

### 記憶體洩漏偵測

```bash
# 監控記憶體趨勢
watch -n 5 'npm run pm2:status | grep equipmentGAME'

# 若記憶體持續增長，檢查：
# 1. 是否有未清除的事件監聽
# 2. 是否有累積的快取
# 3. 是否有未斷開的 MongoDB 連線
```

---

## 3. 瓶頸診斷流程

### 步驟 1：蒐集數據

```javascript
// 在 services/ 層新增簡單的計時器
class PerformanceMonitor {
  static timings = new Map();

  static start(label) {
    this.timings.set(label, Date.now());
  }

  static end(label) {
    const start = this.timings.get(label);
    if (start) {
      const duration = Date.now() - start;
      console.log(`[PERF] ${label}: ${duration}ms`);
      this.timings.delete(label);
    }
  }
}

// 使用
PerformanceMonitor.start('grant-gold');
await walletService.grant(playerId, amount);
PerformanceMonitor.end('grant-gold');
```

### 步驟 2：識別熱點

觀察 24 小時日誌，找出：
- 最常被呼叫的 API / 指令
- 耗時超過 500ms 的操作
- 記憶體突增的時刻

### 步驟 3：優化與驗證

| 層級 | 優化策略 | 預期改善 |
|------|--------|--------|
| **API** | 加 Redis 快取 | 50-100ms |
| **MongoDB** | 新增複合索引 | 100-200ms |
| **Service** | 批量操作 vs 迴圈 | 200-500ms |
| **Bot** | 非同步化重業務邏輯 | 1000-3000ms |

---

## 4. 常見優化策略

### 快取層（Redis）

適合快取：
- 怪物定義（`GET /admin/monsters`）
- 玩家等級表
- NPC 效果定義

```javascript
// 簡易快取（無 Redis 時）
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 分鐘

async function getMonsters() {
  const cached = cache.get('monsters');
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.data;
  }

  const monsters = await db.collection('monsters').find({}).toArray();
  cache.set('monsters', { data: monsters, time: Date.now() });
  return monsters;
}
```

### 資料庫優化

**複合索引範例**：
```javascript
// 在 ensureIndexes() 中新增
db.collection('transactions').createIndex(
  { playerId: 1, createdAt: -1 }
);
```

**分頁查詢**：
```javascript
// 不要 findOne()，用 find().limit(1)
const players = await collection('players')
  .find({ level: { $gte: 50 } })
  .skip((page - 1) * pageSize)
  .limit(pageSize)
  .toArray();
```

### 服務層優化

**串聯改並聯**：
```javascript
// ❌ 低效
await walletService.grant(playerId, 100);
await progressService.grantExp(playerId, 50);
await auditService.log(playerId, 'grant');

// ✅ 高效
await Promise.all([
  walletService.grant(playerId, 100),
  progressService.grantExp(playerId, 50),
  auditService.log(playerId, 'grant')
]);
```

---

## 5. 效能測試清單

部署前驗證：

- [ ] 冷啟動時間 < 5 秒
- [ ] API 響應時間 < 500ms（p95）
- [ ] MongoDB 查詢時間 < 100ms（平均）
- [ ] 記憶體穩定（無洩漏，24h 內增長 < 50MB）
- [ ] PM2 進程穩定（無崩潰，無頻繁重啟）
- [ ] Discord Bot latency < 100ms
- [ ] 同時 10+ 玩家互動無延遲

---

## 6. 工具與指令

### PM2 監控

```bash
# 實時監控
npx pm2 monit

# 檢查內存與 CPU
npx pm2 status

# 保存監控數據
npx pm2 save
```

### MongoDB 分析

```bash
# MongoDB Compass（GUI 工具）
# 下載：https://www.mongodb.com/products/compass
# 連線至 MongoDB_URI，使用內建的 explain / index 分析

# CLI 查詢分析
mongosh
> db.collection('transactions').find().explain('executionStats')
```

### Node.js 內建工具

```bash
# 生成堆棧快照（用於記憶體分析）
node --inspect src/index.js
# 開啟 chrome://inspect，分析堆棧

# 記錄 CPU 火焰圖
node --prof src/index.js
node --prof-process isolate-*.log > profile.txt
```

---

## 7. 應急優化清單

若 API 突然變慢：

1. ✅ 檢查 PM2 日誌：`npm run pm2:logs`
2. ✅ 查看 MongoDB 連線：`db.getConnections()` 是否洩漏
3. ✅ 驗證索引：`db.collection('players').getIndexes()`
4. ✅ 重啟應用：`npm run pm2:restart`
5. ✅ 檢查磁碟空間（特別是 MongoDB）
6. ✅ 確認 .env 中無多餘開發配置

---

## 8. 監控與告警

建議整合：
- **Sentry** - 錯誤追蹤與效能監控
- **Datadog** - 分散式追蹤
- **Grafana** - 自訂儀表板

簡易版本：
```javascript
// 每小時記錄一次健康狀態
setInterval(async () => {
  const mongoDelay = await measureMongoLatency();
  const memUsage = process.memoryUsage().heapUsed / 1024 / 1024;
  
  console.log(`[HEALTH] Mongo: ${mongoDelay}ms, Mem: ${memUsage.toFixed(1)}MB`);
}, 60 * 60 * 1000);
```

---

## 相關文檔

- [MongoDB 最佳實踐](../docs/MONGODB_STANDARDIZATION.md)
- [PM2 部署指南](../README.md#run-with-pm2)
- [Discord.js 官方性能指南](https://discordjs.guide/popular-topics/webhooks.html)

---

## 更新記錄

| 日期 | 主題 |
|------|------|
| 2026-04-15 | 初始化效能分析 SKILL |
