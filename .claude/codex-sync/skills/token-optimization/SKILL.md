---
name: token-optimization
description: Token 消耗過高時使用——快速索引系統、Memory 策略、對話提示技巧，目標節省 35-50% token。
when_to_use: Token 消耗過快、對話快到上限、需要建立架構索引或 Memory 系統時使用。
---

# Token 消耗優化策略

## 概述

隨著專案規模增長（30+ 文件、複雜路由、多層服務），每次對話都從零開始讀檔會導致 **token 消耗爆炸**。此 SKILL 提供系統化降低消耗的方案。

---

## 1. 核心策略

### 消耗來自

```
每次對話:
  ├─ 讀 config.js → 100 token
  ├─ 讀 package.json → 50 token
  ├─ 讀 src/services/*.js → 1000+ token
  ├─ 讀 src/api/routes/*.js → 800+ token
  └─ 讀文檔 → 500+ token
  
總計: 2500+ token 只是「理解當前狀況」
```

### 優化思路

| 方式 | 消耗 | 速度 | 準確度 |
|------|------|------|-------|
| ❌ 每次讀源碼 | 2500+ | 慢 | 100% |
| ✅ 讀索引 + Memory | 300 | 快 | 95% |
| ✅ 讀快照 + 指針 | 500 | 快 | 98% |

---

## 2. 快速索引系統（最重要）

### 2.1 建立 `ARCHITECTURE.md`

```markdown
# Equipment Game - 架構索引

## 快速導航

### API 端點
- 怪物管理: `src/api/routes/adminMonsterRoutes.js` (L29-150)
- 玩家管理: `src/api/routes/adminPlayerRoutes.js` (L15-80)
- 商店: `src/api/routes/adminShopRoutes.js` (L20-110)

### 服務層
- MonsterService: `src/services/monsterService.js` (210 行)
  - listMonsters() - L25
  - createMonster() - L45
  - getState() - L80
  
- PlayerService: `src/services/playerService.js` (180 行)
  - ensurePlayer() - L10
  - grantCurrency() - L40

### 前端模塊
- 怪物編輯器: `src/web/public/admin.monsters.js` (650 行)
  - loadMonsters() - L15
  - createMonster() - L45
  - renderMonsterList() - L150

### Discord Bot
- 命令定義: `src/bot/commands.js` (200 行)
- 事件處理: `src/bot/client.js` (400 行)
- 處理器: `src/bot/handlers/` (8 個檔案)

### 共用工具
- 錯誤: `src/shared/errors.js` (30 行，AppError 類)
- 回應: `src/shared/response.js` (15 行，ok/fail 函式)
- Cloudinary: `src/shared/cloudinaryUpload.js` (50 行)

### Collections（MongoDB）
| Collection | 用途 | 索引 |
|-----------|------|------|
| players | 玩家基本資料 | discordId (unique) |
| wallets | 金幣/鑽石 | playerId (unique) |
| monsters | 怪物定義 | id, zone |
| items | 道具定義 | id (unique) |
| transactions | 交易紀錄 | playerId, createdAt |

### 常用命令
```bash
npm start              # 啟動 Bot + API
npm run pm2:restart   # 重啟進程
npm run discord:register # 註冊斜杠命令
npm run check         # 語法檢查 + 行數檢查
```
```

### 2.2 好處

原本對話：
```
我: "怎麼建立新怪物？"
Claude: 需要讀 monsterService.js (200行) + adminMonsterRoutes.js (150行) + admin.monsters.js (650行)
消耗: 1500+ token
```

有索引後：
```
我: "怎麼建立新怪物？"
Claude: 查 ARCHITECTURE.md，找到 MonsterService.createMonster() - L45
消耗: 50 token（只讀相關片段）
```

---

## 3. Project Memory 系統

### 3.1 策略性記憶

```
C:\Users\appsk\.claude\projects\...\memory\
├── MEMORY.md                    ← 索引（保持 < 200 行）
├── ARCHITECTURE_DECISIONS.md   ← 為什麼這樣做
├── MONGODB_SCHEMA.md           ← 所有 Collections 的字段定義
├── API_CONTRACTS.md            ← 所有 API 的 request/response 格式
├── DISCORD_COMMANDS.md         ← 所有斜杠命令列表
└── GAME_MECHANICS.md           ← 遊戲邏輯（獲利公式、戰鬥流程等）
```

### 3.2 MEMORY.md 模板（精簡版）

```markdown
# Memory Index

**專案**：Equipment Game（Discord-first 遊戲平台）
**技術棧**：Node.js + Discord.js + Express + MongoDB + Vanilla JS
**規模**：30+ API 端點、10+ Discord 命令、8 個 Admin 模塊

## 核心決策
- [MongoDB 統一](MONGODB_UNIFIED.md) — 單一儲存層
- [Token 優化](TOKEN_OPTIMIZATION.md) — 快速索引 + Memory

## 快速連結
- 架構圖：`ARCHITECTURE.md`
- MongoDB Schema：`MONGODB_SCHEMA.md`
- API 契約：`API_CONTRACTS.md`
- Discord 命令：`DISCORD_COMMANDS.md`

## 最近的坑
- PM2 多進程競態條件（已用原子操作解決）
- 互動超時（已用 deferReply 解決）
- 圖片上傳失敗（Cloudinary 配置）
```

### 3.3 MongoDB Schema 記憶

```markdown
# MongoDB Schema Reference

## players
```javascript
{
  discordId: string (unique),
  displayName: string,
  level: number,
  exp: number,
  createdAt: ISO string
}
```

## wallets
```javascript
{
  playerId: string (unique),
  gold: number,
  diamond: number,
  lastUpdated: ISO string
}
```
// ... 其他 Collections
```

### 3.4 API 契約記憶

```markdown
# API Contracts

## GET /admin/monsters
Request: `Authorization: Bearer <token>`
Response: 
```json
{
  "status": "ok",
  "data": [
    { "id": "...", "name": "...", "level": 10, "maxHp": 100 }
  ]
}
```

## POST /admin/monsters
Request:
```json
{
  "name": "新怪物",
  "level": 15,
  "maxHp": 120,
  "str": 20,
  "imageUrl": "https://..."
}
```
```

---

## 4. 快速查詢腳本

### 4.1 `scripts/quick-info.js`

```javascript
#!/usr/bin/env node
// 快速輸出專案資訊，避免 Claude 讀檔

const fs = require("fs");
const path = require("path");

const args = process.argv[2];

if (args === "api") {
  // 列出所有 API 端點
  const routeFiles = fs.readdirSync("src/api/routes");
  console.log("=== API Routes ===");
  routeFiles.forEach(file => {
    const content = fs.readFileSync(path.join("src/api/routes", file), "utf-8");
    const routes = content.match(/router\.(get|post|put|delete)\("([^"]+)"/g) || [];
    console.log(`\n${file}:`);
    routes.forEach(r => console.log(`  ${r}`));
  });
} else if (args === "commands") {
  // 列出所有 Discord 命令
  const content = fs.readFileSync("src/bot/commands.js", "utf-8");
  const cmds = content.match(/\.setName\("([^"]+)"\)/g) || [];
  console.log("=== Discord Commands ===");
  cmds.forEach(c => console.log(c.replace(/[.\("\']/g, "")));
} else if (args === "schema") {
  // MongoDB Collections 列表
  const content = fs.readFileSync("src/adapters/mongo/createMongoClient.js", "utf-8");
  const colls = content.match(/db\.collection\("([^"]+)"\)/g) || [];
  console.log("=== MongoDB Collections ===");
  const unique = new Set(colls.map(c => c.match(/"([^"]+)"/)[1]));
  unique.forEach(c => console.log(`  - ${c}`));
} else if (args === "status") {
  // 專案狀態概覽
  const stats = {
    botCommands: (fs.readFileSync("src/bot/commands.js", "utf-8").match(/setName/g) || []).length,
    apiRoutes: (fs.readFileSync("src/api/routes/adminMonsterRoutes.js", "utf-8").match(/router\./g) || []).length,
    services: fs.readdirSync("src/services").length,
  };
  console.log("=== Project Status ===");
  console.log(JSON.stringify(stats, null, 2));
}
```

使用方式：
```bash
node scripts/quick-info.js api       # 列出所有 API 端點
node scripts/quick-info.js commands  # 列出所有 Discord 命令
node scripts/quick-info.js schema    # 列出所有 Collections
node scripts/quick-info.js status    # 專案統計
```

### 4.2 在 package.json 中新增

```json
{
  "scripts": {
    "info:api": "node scripts/quick-info.js api",
    "info:commands": "node scripts/quick-info.js commands",
    "info:schema": "node scripts/quick-info.js schema",
    "info:all": "node scripts/quick-info.js status"
  }
}
```

---

## 5. 對話提示技巧

### 5.1 提供精準上下文

❌ **消耗大**：
```
我: "幫我新增一個 API"
Claude: 不知道你要什麼，讀了 20 個檔案
```

✅ **消耗小**：
```
我: "我想在 adminMonsterRoutes.js 新增 GET /admin/monsters/search"
Claude: 知道具體位置，只讀相關片段
```

### 5.2 參考 Memory

```
我: "根據 ARCHITECTURE.md，MonsterService 應該在哪裡新增方法？"
Claude: 直接查 Memory，不需讀源碼
```

### 5.3 使用 Memory 優先

```
對話開始時說：
"可以先查一下 .claude/projects/*/memory/ARCHITECTURE.md 嗎？"

Claude: 自動載入，節省 500+ token
```

---

## 6. 文檔分層策略

### 層級 1：快速導航（5 分鐘）

檔案：`ARCHITECTURE.md` + `MEMORY.md`

```
Q: "API 在哪裡？"
A: 看 ARCHITECTURE.md → L5-10（即時找到）
消耗: 100 token
```

### 層級 2：特定功能（15 分鐘）

檔案：`docs/ADMIN_BACKEND_DEVELOPMENT.md`

```
Q: "怎麼新增 Admin 功能？"
A: 看文檔 → 有完整範例
消耗: 300 token
```

### 層級 3：深入源碼（30 分鐘）

檔案：實際源碼

```
Q: "MonsterService.createMonster 為什麼要 throw AppError？"
A: 看源碼 + 檔案註釋 → 理解設計
消耗: 1000+ token（但只有深度問題才需要）
```

---

## 7. 檢查清單

設置 Token 優化系統：

- [ ] **建立 `ARCHITECTURE.md`**（列出所有檔案 + 行數 + 責任）
- [ ] **建立 Memory 檔案集**（MONGODB_SCHEMA.md, API_CONTRACTS.md 等）
- [ ] **建立 `scripts/quick-info.js`**（快速查詢腳本）
- [ ] **在 `.claude/projects/*/memory/MEMORY.md` 維護索引**
- [ ] **養成習慣**：對話時先說「查 ARCHITECTURE.md」而不是「讀這個文件」
- [ ] **定期更新**：每當新增 API/命令/Collection 時更新索引

---

## 8. 實際案例對比

### 情景：「新增一個商店折扣功能」

#### ❌ 低效方式（消耗 2000+ token）
```
我: "幫我新增折扣功能"
Claude: 讀 adminShopRoutes.js (150 行)
        讀 shopService.js (300 行)
        讀 admin.shop.js (500 行)
        讀 MongoDB schema...
結果: 總共讀了 6 個檔案才理解
```

#### ✅ 高效方式（消耗 300 token）
```
我: "根據 ARCHITECTURE.md，
     在 shopService.js L150 附近新增 applyDiscount() 方法，
     API 契約參考 API_CONTRACTS.md 的 Shop 部分"
     
Claude: 只讀那 30 行代碼，直接寫
結果: 精準修改，消耗最少
```

---

## 9. Token 預算範例

### 小型對話（單一任務）
```
讀 ARCHITECTURE.md: 100 token
讀相關檔案片段: 200 token
生成代碼: 400 token
總計: 700 token（而不是 2000+）
```

### 大型對話（多個任務）
```
讀 Memory: 200 token
讀 ARCHITECTURE.md: 100 token
讀 3 個檔案片段: 600 token
提出 3 個想法: 800 token
生成代碼: 1000 token
總計: 2700 token（節省 40-50%）
```

---

## 10. 自動化更新

### 定期刷新索引

```bash
# 每週運行，更新索引
npm run info:all >> docs/PROJECT_STATUS_$(date +%Y%m%d).md

# 檢查是否有新的斜杠命令
npm run info:commands > temp.txt
diff temp.txt docs/DISCORD_COMMANDS.md
```

---

## 最終建議

1. **立即做**：建 `ARCHITECTURE.md` + Memory（1 小時）
2. **一週內**：建 `scripts/quick-info.js`（30 分鐘）
3. **持續優化**：每次新增功能時更新索引（5 分鐘）

**預期節省**：35-50% token 消耗 📉

---

## 相關文檔

- [Discord 命令規範](../docs/DISCORD_CONVENTIONS.md)
- [Admin 後台開發](../docs/ADMIN_BACKEND_DEVELOPMENT.md)
- [MongoDB 標準化](../docs/MONGODB_STANDARDIZATION.md)

---

## 更新記錄

| 日期 | 變更 |
|------|------|
| 2026-04-15 | 初始化 Token 優化 SKILL |
