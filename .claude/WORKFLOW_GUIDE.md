# equipmentGAME Sub Agent 工作流指南

## 🎯 目標
獨立開發者高效開發 + Token 成本最小化

## 📊 工作流架構

```
任務類型          推薦 Agent      預期 Token 節省
─────────────────────────────────────────────────
找代碼位置      Explore Agent    20-30%（vs 手動 grep）
設計新功能      Plan Agent       10-15%（聚焦設計）
實現代碼        General-Purpose  15%（使用 Edit）
審查程式碼      simplify skill   無需額外 token
定期維護        /schedule        後台執行，不佔 context
```

---

## 🚀 使用場景 & 命令

### 場景 1️⃣ : 添加新職業

```bash
# 步驟 1: 快速查找現有職業實裝
/explore agent
"快速掃描現有 7 個職業的實裝位置，尤其是數值定義檔"

# 步驟 2: 設計新職業
/plan agent
"設計新職業的技能樹、數值平衡、經濟影響"

# 步驟 3: 實現
[General-purpose] 代碼實現 + 測試

# 步驟 4: 自動檢查
# → 隔週三 18:00 自動執行 simplify 審查
```

**Token 節省**: ~35% vs 全部用 General-purpose

---

### 場景 2️⃣ : 經濟系統調整

```bash
# 步驟 1: 探索現有結構
/explore agent
"掃描 MongoDB schema、掉落表、物品定義"

# 步驟 2: 參考優化策略
# → 自動加載 Memory: TOKEN_OPTIMIZATION.md

# 步驟 3: 設計平衡變動
/plan agent
"基於現有數據設計經濟平衡調整"

# 步驟 4: 實現
[General-purpose] 實現 + 執行經濟測試
```

**自動化**: 每月 1 號 10:00 執行 token 審計，追蹤成效

---

### 場景 3️⃣ : Bug 修復

```bash
# 直接使用 General-purpose
[General-purpose] 診斷 + 修復 + 測試

# 修復後自動檢查程式碼品質
# → simplify skill（自動或手動觸發）
```

**快速路徑**: 不需要 Plan Agent，直接實現

---

## 🔄 自動化任務時間表

| 時間 | 任務 | 效果 |
|------|------|------|
| **每週一 09:00** | 記憶整合 | 節省 20% token |
| **每週三 18:00** | 代碼品質檢查 | 發現程式碼重用機會 |
| **每月 1 號 10:00** | Token 審計 | 追蹤優化成效 |

✅ 所有任務已配置完成，無需手動干預

---

## 💾 如何調用記憶系統

### 自動加載（已配置）
每次讀取代碼前，自動加載：
- `TOKEN_OPTIMIZATION.md` - token 節省策略
- `JOB_MECHANICS_IMPLEMENTATION.md` - 職業系統文檔
- `QUICK_REFERENCE.md` - 快速查詢

### 手動整合記憶
```bash
/consolidate-memory
```
合併重複、清理過期內容，再節省 20% token

---

## 🎮 測試命令

```bash
# 職業系統測試（自動監視）
# → 在 VSCode 或 IDE 執行，實時反饋

# 經濟系統測試（自動監視）
# → 調整經濟參數時自動驗證

# 完整測試
npm test
```

---

## 📈 Token 優化成效指標

目標：相比直接使用 General-purpose，節省 **45-50%** token

| 優化手段 | 節省 |
|---------|------|
| Explore Agent（vs 手動查詢） | 20-30% |
| Edit（vs Write） | 15% |
| 記憶系統 | 20% |
| 後台自動化任務 | 無限 |
| **總計** | **45-50%** |

---

## 🛠️ 常用快捷命令

```bash
# 查看目前任務狀態
/scheduled-tasks list

# 立即執行某個任務（不等排程）
/scheduled-tasks run equipment-game-weekly-memory

# 啟動開發伺服器
npm run dev

# 快速搜尋代碼（用 Explore Agent 替代）
[Explore] "搜尋 xxx 的實裝位置"
```

---

## 📝 工作流檢查清單

新功能開發時：
- [ ] 用 Explore Agent 查找相關代碼
- [ ] 用 Plan Agent 設計架構
- [ ] 用 General-purpose 實現
- [ ] 自動測試通過
- [ ] 等待隔週三自動 simplify 審查
- [ ] Commit（自動前置檢查）

Bug 修復時：
- [ ] General-purpose 診斷 + 修復
- [ ] 單元測試通過
- [ ] 可選：立即執行 simplify 檢查
- [ ] Commit

定期維護：
- [ ] 每週一 09:00 記憶整合（自動）
- [ ] 每週三 18:00 程式碼品質檢查（自動）
- [ ] 每月 1 號 10:00 token 審計（自動）

---

## 📞 有問題？

1. **設定檔**: `.claude/settings.json`
2. **任務配置**: `.claude/scheduled-tasks/*`
3. **記憶系統**: `~/.claude/projects/.../memory/`
4. **快速查詢**: `QUICK_REFERENCE.md` in memory

---

**最後更新**: 2026-04-16  
**配置版本**: 1.0  
**目標成效**: 45-50% token 節省 ✨
