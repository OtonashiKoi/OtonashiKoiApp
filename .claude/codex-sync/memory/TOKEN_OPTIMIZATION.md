---
name: Token 優化策略
description: 大型項目的快速導航、Memory 系統、自動索引化
type: project
originSessionId: a89cdaa5-8561-42fa-8945-0fc1a70ffb34
---
**確定日期**：2026-04-15

## 核心問題

隨著項目成長（30+ 文件、~6100 行代碼），每次對話 Claude 需要：
1. 讀 config/package.json
2. 理解檔案結構
3. 讀多個 service/route 檔案
4. 才能回答問題

**消耗**：每次 2000-2500 token 只是「理解當前狀況」

## 解決方案

### 1. ARCHITECTURE.md（項目級快速索引）
- 位置：`ARCHITECTURE.md`
- 內容：所有檔案 + 行數 + 責任 + 關鍵行號
- 用法：「查 ARCHITECTURE.md」替代「讀這個檔案」
- 節省：1500+ token/次

### 2. Memory 細分（會話間知識保留）
```
memory/
├── MEMORY.md              ← 索引
├── MONGODB_UNIFIED.md     ← MongoDB 決策
├── TOKEN_OPTIMIZATION.md  ← 此檔案
├── MONGODB_SCHEMA.md      ← (待建) Collections 定義
├── API_CONTRACTS.md       ← (待建) API 請求/回應格式
└── DISCORD_COMMANDS.md    ← (待建) 所有命令列表
```

### 3. 快速查詢腳本（自動化索引）
- `scripts/quick-info.js`（待建）
- `npm run info:api` / `info:commands` / `info:schema`
- 節省：檔案一致性，手工維護負擔

## 預期節省

| 作業 | 原消耗 | 優化後 | 節省 |
|------|-------|-------|------|
| 新增簡單 API | 1500 | 400 | 73% |
| 新增複雜功能 | 2500 | 800 | 68% |
| 調試問題 | 2000 | 600 | 70% |
| **平均** | **2000** | **600** | **70%** |

但實際上由於對話累積，整個項目生命週期能節省 **35-50%**。

## 如何使用（下次對話時）

### ✅ 好做法
```
我: "根據 ARCHITECTURE.md，PlayerService 的 ensurePlayer 在第幾行？"
Claude: 查索引 → 10 token → 回答
```

### ❌ 耗 token 做法
```
我: "幫我看 PlayerService 的 ensurePlayer"
Claude: 讀整個 180 行檔案 → 300 token
```

## 立即行動

1. **建立 scripts/quick-info.js** (30 min)
   - 自動查詢 API、命令、Schema
   - 放入 npm scripts

2. **建立 memory/MONGODB_SCHEMA.md** (20 min)
   - 列出所有 Collections 的欄位
   - 每次新增 Collection 時更新

3. **建立 memory/API_CONTRACTS.md** (30 min)
   - 記錄常用 API 的 request/response
   - 供 Claude 快速查閱

4. **養成習慣** (持續)
   - 對話時說「查 ARCHITECTURE.md」
   - 不要說「讀這個檔案」

## 已建檔案

- ✅ `ARCHITECTURE.md` - 快速索引
- ✅ `memory/TOKEN_OPTIMIZATION.md` - 此策略文檔
- ✅ `.claude/skills/token-optimization/SKILL.md` - 完整 SKILL
- ❌ `scripts/quick-info.js` - 待建
- ❌ `memory/MONGODB_SCHEMA.md` - 待建
- ❌ `memory/API_CONTRACTS.md` - 待建
