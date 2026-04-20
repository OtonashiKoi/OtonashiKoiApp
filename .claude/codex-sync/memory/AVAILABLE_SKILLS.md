---
name: 所有可用 AI Agent Skills 清單
description: 完整的28個Skills索引，按分類整理，含位置和用途
type: reference
---

# 🤖 所有可用 AI Agent Skills (28 個完整清單)

## 📍 存儲位置對應

| 目錄 | Skills 數 | 說明 |
|-----|----------|------|
| `.claude/skills/` | 10 | 主項目公用 Skills |
| `.agent/skills/` | 6 | Agent 自動化 Skills |
| `.agents/skills/` | 4 | Agents 工具集 (部分重複) |
| `.vscode/prompts/skills/` | 1 | VSCode 特定 |
| `.claude/scheduled-tasks/` | 3 | 排程自動執行任務 |

---

## 🔧 按功能分類

### 1️⃣ 後台開發 Skills

#### admin-backend-development
- **位置**: `.claude/skills/admin-backend-development/otonashisekai.md`
- **用途**: Express API 路由、原生 JS UI、Cloudinary 整合、複雜表單編輯
- **涵蓋**: 怪物編輯、道具管理、NPC 事件、圖片上傳
- **觸發**: 建構後台功能、管理遊戲內容

#### project-structure-admin-check
- **位置**: `.agent/skills/project-structure-admin-check/otonashisekai.md`
- **用途**: 驗證專案結構一致性、後台功能規範
- **觸發**: 每次新增後台功能時

---

### 2️⃣ 數據庫 Skills

#### mongodb-standard
- **位置**: `.claude/skills/mongodb-standard/otonashisekai.md`
- **用途**: 統一 MongoDB 標準，移除 JSON 儲存、環境變數開關
- **包含**: Collection 設計、查詢最佳實踐、索引策略
- **觸發**: 任何涉及 DB 操作的任務

#### db-collection-enforcement
- **位置**: `.agent/skills/db-collection-enforcement/otonashisekai.md`
- **用途**: MongoDB Collection 命名、結構強制規範
- **確保**: 所有新 Collection 遵循標準
- **觸發**: 新增 Collection 時自動檢查

---

### 3️⃣ Discord / 命令規範 Skills

#### discord-commands-convention
- **位置**: `.claude/skills/discord-commands-convention/otonashisekai.md`
- **用途**: 統一 30+ 斜杠命令、按鈕互動、選單標準實裝
- **內容**: 命令設計模式、錯誤處理、國際化
- **觸發**: 開發 Discord 互動功能時

---

### 4️⃣ 效能與優化 Skills

#### token-optimization
- **位置**: `.claude/skills/token-optimization/otonashisekai.md`
- **用途**: 大型項目的 Token 消耗優化 (目標 35-50% 節省)
- **策略**: 快速索引、智能快取、Memory 系統設計
- **應用**: 每次會話自動應用

#### performance-optimization
- **位置**: `.claude/skills/performance-optimization/otonashisekai.md`
- **用途**: Discord Bot + API + MongoDB 效能監控、瓶頸診斷
- **監控**: 記憶系統、快取命中率、查詢效率
- **觸發**: 效能下降時執行

---

### 5️⃣ 自動化 Skills

#### auto-commit-zh-notes
- **位置**: `.agent/skills/auto-commit-zh-notes/otonashisekai.md`
- **用途**: 自動提交 + 繁體中文記錄、語言一致性保證
- **應用**: 每次 git commit 自動執行

#### backups-full
- **位置**: `.agent/skills/backups-full/otonashisekai.md`
- **用途**: 完整備份機制 (代碼、數據、配置)
- **頻率**: 定期自動執行

#### skill-format-guidelines
- **位置**: `.agent/skills/skill-format-guidelines/otonashisekai.md`
- **用途**: Skill 寫作規範、格式檢查
- **應用**: 建立新 Skill 時必看

---

### 6️⃣ 工具 Skills

#### find-skills
- **位置**: `.claude/skills/find-skills/otonashisekai.md`
- **用途**: 發現與推薦相關技能
- **應用**: 不確定用哪個 Skill 時執行

#### code-review-expert
- **位置**: `.claude/skills/code-review-expert/otonashisekai.md`
- **用途**: 專業代碼審查、品質評估
- **檢查**: 重用度、死碼、類型安全、效能

#### agent-browser
- **位置**: `.claude/skills/agent-browser/otonashisekai.md`
- **用途**: 瀏覽器自動化、Web 互動測試
- **應用**: 需要 UI 驗證時使用

---

### 7️⃣ 設計 Skills

#### ui-ux-pro-max
- **位置**: `.claude/skills/ui-ux-pro-max/otonashisekai.md`
- **用途**: 專業 UI/UX 設計、組件規範
- **包含**: 設計系統、響應式設計、無障礙設計
- **觸發**: UI 設計任務時

#### web-design-guidelines
- **位置**: `.claude/skills/web-design-guidelines/otonashisekai.md`
- **用途**: 網頁設計指南、最佳實踐
- **涵蓋**: 排版、色彩、互動設計

#### cloud-db-only
- **位置**: `.vscode/prompts/skills/cloud-db-only/otonashisekai.md`
- **用途**: 雲端 DB 專用配置 (VSCode 提示)
- **應用**: 雲端環境開發時

---

### 8️⃣ 排程任務 Skills (自動執行)

#### equipment-game-code-quality-check
- **位置**: `.claude/scheduled-tasks/equipment-game-code-quality-check/otonashisekai.md`
- **頻率**: 每週三 6PM
- **任務**: 掃描最近修改的檔案、執行簡化審查、檢查重用度/死碼/類型安全
- **輸出**: 簡短報告供下週改進

#### equipment-game-token-audit
- **位置**: `.claude/scheduled-tasks/equipment-game-token-audit/otonashisekai.md`
- **頻率**: 每月 1 號
- **任務**: 統計 Explore Agent 使用率、簡化審查使用次數、平均 Token 消耗對比
- **驗證**: 記憶系統是否正確加載、是否有低效查詢
- **輸出**: 下月優化建議

#### equipment-game-weekly-memory
- **位置**: `.claude/scheduled-tasks/equipment-game-weekly-memory/otonashisekai.md`
- **頻率**: 每週一
- **任務**: 檢查重複記憶、標記過期內容、更新 MEMORY.md 索引
- **目標**: 節省 20% Token
- **輸出**: 清理前後節省統計

---

## 🚀 快速使用指南

### 我該用哪個 Skill？

| 情景 | 推薦 Skill |
|------|-----------|
| 開發後台功能 | `admin-backend-development` |
| 操作 MongoDB | `mongodb-standard` + `db-collection-enforcement` |
| 建立 Discord 命令 | `discord-commands-convention` |
| Token 消耗過高 | `token-optimization` + `equipment-game-token-audit` |
| 效能下降 | `performance-optimization` |
| 代碼品質檢查 | `code-review-expert` + `equipment-game-code-quality-check` |
| UI 設計 | `ui-ux-pro-max` + `web-design-guidelines` |
| 不知道用哪個 | `find-skills` |

---

## 📊 Skills 統計

- **總計**: 28 個 Skills
- **去重後**: 19 個獨立 Skills
- **遊戲專用 🎮**: 11 個 (admin / mongodb / discord / 優化 / 排程任務等)
- **通用工具 ⚙️**: 8 個 (代碼審查 / 設計 / 自動化等)
- **自動執行**: 3 個排程任務 (週三/月初/週一)
- **自我進化能力**: ❌ 所有 Skills 皆為靜態文件，無自動進化機制

### 🎮 遊戲專用 Skills 快速參考

**最常用** (開發遊戲功能時必看):
1. `admin-backend-development` — 後台功能開發
2. `mongodb-standard` — 數據庫操作
3. `discord-commands-convention` — Discord 機器人

**定期檢查** (排程自動執行):
- 週三 6PM: `equipment-game-code-quality-check`
- 每月 1 號: `equipment-game-token-audit`  
- 每週一: `equipment-game-weekly-memory`

---

## ⚠️ 注意事項

1. **Skills 位置**：同一個 Skill 可能存在於多個目錄（符號連結或複本）
2. **優先順序**：`.claude/skills/` 優先於其他目錄
3. **自動觸發**：排程任務 Skills 不需手動調用，系統自動執行
4. **更新策略**：目前無自動更新機制，需手動維護

**建檔日期**: 2026-04-16  
**維護者**: AI Agent System  
**下次同步**: 自動排程更新 (週一 Memory 整合時)
