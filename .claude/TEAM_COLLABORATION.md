# 多角色協作指南

**團隊結構**: 全棧開發 + UI/UX 設計師 + APP 開發（可選）

---

## 👥 三大角色工作流

### 1️⃣ 全棧工程師（你現在的角色）

**觸發詞**: `[找]` `[設計]` `[實現]`  
**領域**: `@game` `@item` (核心系統)

```bash
[找] @game 現有職業系統
[設計] @game 新職業平衡
[實現] @game 職業技能開發

[找] @item 道具 schema
[實現] @item 掉落邏輯
```

**優先**: 核心遊戲邏輯、API、資料庫

**自動加載**: 職業系統、經濟系統、Token 優化策略

---

### 2️⃣ UI/UX 設計師（新角色）

**觸發詞**: `[畫]` `[設計]` `[改]`  
**領域**: `@admin` `@player` (介面)  
**專用 Model**: Sonnet（強化設計能力）

```bash
[設計] @admin 後台儀表板架構
[畫] @admin 玩家搜尋表單
[改] @admin 側邊欄配色優化

[設計] @player 玩家資訊頁流程
[畫] @player 頭像 + 統計佈局
```

**優先**: UI/UX 設計、視覺規範、組件庫  
**自動加載**: 設計系統、組件庫、後台規格

---

### 3️⃣ APP 前端開發師（未來）

**觸發詞**: `[找]` `[實現]` `[改]`  
**領域**: `@player` `@game` (客戶端)

```bash
[找] @player 玩家相關 API
[實現] @player 玩家資訊頁面
[改] @game 遊戲 UI 性能優化
```

**優先**: React/Vue 實現、客戶端交互、性能  
**自動加載**: 設計系統、組件庫、API 文檔

---

## 🔄 協作流程（完整版）

### 開發新功能：後台玩家管理

```
Day 1 - UI/UX 設計師
  ↓
[設計] @player 後台玩家管理 UI 架構
[畫] @player 玩家搜尋、詳情、操作界面
  ↓ 輸出：設計稿 + API 需求 + 互動規格
  ↓ 更新記憶：ADMIN_UI_SPECS.md

Day 2 - 全棧工程師（你）
  ↓
[找] @player 看設計師的規格（自動加載）
[設計] @player 玩家 API 架構
[實現] @player 實現 GET/PATCH/POST 玩家相關 API
  ↓ 單元測試通過
  ↓ 通知設計師

Day 3 - UI/UX 設計師
  ↓
[改] @player 根據 API 反饋調整設計
  ↓ 更新記憶

Day 4 - APP 前端（未來）
  ↓
[找] @player 查看最新設計 + API
[實現] @player React/Vue 前端組件
```

**總耗時**: 4 天（vs 單人 7 天）

---

## 💾 記憶系統協作

### 設計師主要維護
```
DESIGN_SYSTEM.md        # 全局色彩、排版、動畫
COMPONENT_LIBRARY.md    # 可重用組件
ADMIN_UI_SPECS.md       # 後台設計規格
GAME_UI_SPECS.md        # 遊戲 UI 規格（待建）
```

### 工程師主要維護
```
JOB_MECHANICS_IMPLEMENTATION.md
QUICK_REFERENCE.md
API_DOCUMENTATION.md (待建)
```

### 共同維護
```
ADMIN_SYSTEM_SPECS.md       # 後台需求
SUB_AGENT_STRATEGY.md       # 工作流
```

**自動同步**:
```
設計師更新 DESIGN_SYSTEM → 工程師自動加載
工程師實現後更新 API → 設計師參考
```

---

## 📊 工作流優化對比

### 傳統開發（無分工）
```
你: 設計 → 實現 → 測試
時間: 7 天
Token: 100%
```

### 多角色協作（已配置）
```
設計師: 設計 (Day 1)
你: API + 核心 (Day 2-3)
前端: UI (Day 4)

時間: 4 天（平行化）
Token: 70%（記憶共享）
質量: ↑ (專業分工)
```

---

## 🎯 使用場景與命令速查

### 場景 A: 設計師開始後台設計
```bash
# 設計師
[設計] @admin 後台版本 v1.0 - 包含儀表板、玩家、道具管理
[畫] @admin 儀表板的細部設計 - 卡片排版、圖表組件

# 你
[找] @admin 看設計規格
[實現] @admin 後台 API - GET/PATCH 玩家、道具
```

### 場景 B: 遊戲前端 UI 更新
```bash
# 設計師
[改] @game 戰鬥 UI 配色優化

# APP 開發
[找] @game 看最新設計
[實現] @game React 戰鬥 UI 組件
```

### 場景 C: 新道具系統
```bash
# 你
[設計] @item 新道具系統架構
[實現] @item 道具 CRUD API

# 設計師
[設計] @item 道具編輯器 UI
[畫] @item 道具卡片、稀有度顯示

# 你（如需要）
[實現] @item 前端道具編輯器
```

---

## ✨ 關鍵優勢

| 方面 | 收益 |
|------|------|
| **速度** | 設計 + 開發平行化，減少等待 |
| **品質** | 專業分工，UI/UX 設計更精良 |
| **Token** | 記憶系統共享，節省 35-50% |
| **維護** | 清晰的代碼 & 設計分工邊界 |
| **擴展** | 容易加入 APP 開發師 |

---

## 📋 新成員加入檢查清單

### UI/UX 設計師第一天
- [ ] 讀 `UIUX_DESIGNER_WORKFLOW.md`
- [ ] 讀 `DESIGN_SYSTEM.md`
- [ ] 讀 `COMPONENT_LIBRARY.md`
- [ ] 開始 [設計] @admin 後台初版

### APP 前端開發第一天
- [ ] 讀 `SIMPLE_WORKFLOW.md`
- [ ] 讀 `DESIGN_SYSTEM.md`
- [ ] 讀 `COMPONENT_LIBRARY.md`
- [ ] 看現有 API 文檔
- [ ] 開始 [實現] @player/@game 前端

---

## 🚀 立即開始

### 為設計師配置完成 ✅

你現在只需：
1. **邀請設計師** 加入專案
2. **分享文檔**
   - `.claude/UIUX_DESIGNER_WORKFLOW.md`
   - `memory/DESIGN_SYSTEM.md`
   - `memory/COMPONENT_LIBRARY.md`
3. **開始協作**
   ```
   設計師: [設計] @admin 後台版本 v1.0
   你: 看記憶 → [實現] API
   ```

---

**全部設置完畢！** 🎉  
團隊準備就緒，下次只要說「[設計]/[實現]/[找]」就行。

---

**最後更新**: 2026-04-16  
**配置版本**: 多角色協作 v1.0
