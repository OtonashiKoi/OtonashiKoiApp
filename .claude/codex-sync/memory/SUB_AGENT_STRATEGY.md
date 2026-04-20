---
name: Sub Agent 工作流策略
description: 優化 Claude Code 工作流的代理分工和自動化配置
type: project
originSessionId: 79c1604f-834b-4dfa-a16d-7ed599900fc9
---
# Sub Agent 工作流策略

**決策日期**: 2026-04-16
**配置狀態**: ✅ 完成部署

## 架構設計

### 三層代理分工
```
Explore Agent      → 快速掃描代碼、檔案查找（20-30% token 節省）
Plan Agent         → 功能設計、架構規劃（10-15% token 節省）
General-Purpose    → 實現代碼、修復 Bug（直接實現）
```

### 自動化任務
- **每週一 09:00**: 記憶整合（consolidate-memory）→ 20% token 節省
- **每週三 18:00**: 程式碼品質檢查（simplify 審查）
- **每月 1 號 10:00**: Token 審計（追蹤優化成效）

## 配置檔案清單

| 檔案 | 用途 |
|------|------|
| `.claude/settings.json` | Sub Agent 規則、Hooks、Memory 配置 |
| `.claude/launch.json` | 開發伺服器配置 |
| `.claude/WORKFLOW_GUIDE.md` | 工作流快速參考 |

## Token 優化成效

**目標**: 45-50% token 節省（相比直接使用 General-purpose）

| 優化手段 | 節省 |
|---------|------|
| Explore Agent（vs 手動 grep） | 20-30% |
| Edit（vs Write） | 15% |
| 記憶系統自動加載 | 20% |
| 後台自動化任務 | 無限 |

## 使用場景

### 添加新職業
```
Explore → 找現有職業實裝
Plan → 設計新職業
General-purpose → 實現
→ 自動簡化審查
```

### 經濟系統調整
```
Explore → 掃描 MongoDB schema
Plan → 設計平衡變動
General-purpose → 實現
→ 每月自動 token 審計
```

### Bug 修復
```
General-purpose → 直接診斷 + 修復
→ 可選手動 simplify 檢查
```

## 自動記憶加載

```json
"memory": {
  "autoLoad": [
    "TOKEN_OPTIMIZATION.md",
    "JOB_MECHANICS_IMPLEMENTATION.md",
    "QUICK_REFERENCE.md"
  ]
}
```

每次讀取代碼前自動加載，減少重複加載 context

## 後續優化點

1. 監控實際 token 節省（每月審計）
2. 如果某個 Agent 未被充分利用，調整觸發規則
3. 根據項目進展，調整記憶的 autoLoad 清單
4. 考慮為不同職業系統分別創建 Plan 任務

---

**配置者**: Claude Code  
**下次審查**: 2026-05-16（一個月後）
