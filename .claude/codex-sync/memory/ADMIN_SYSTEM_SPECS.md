---
name: 後台管理系統規格
description: 後台 UI/UX、道具管理、玩家管理的設計與需求
type: project
originSessionId: 79c1604f-834b-4dfa-a16d-7ed599900fc9
---
# 後台管理系統規格

**狀態**: 📝 設計中  
**領域標籤**: `@admin` `@item` `@player`

---

## 模塊一：後台 UI/UX

### 儀表板 (Dashboard)
- [ ] 玩家在線統計
- [ ] 經濟流向監控
- [ ] 異常告警顯示
- [ ] 快速操作按鈕

### 設計檔案
- **Figma**: (待補)
- **設計師**: (待補)
- **完成度**: 0%

---

## 模塊二：道具管理 (@item)

### 需求
- 道具列表檢視（分類、搜尋、過濾）
- 道具編輯器（稀有度、屬性、掉落率）
- 道具稀有度系統管理
- 道具掉落表配置

### 檔案位置
- 後端 API: (待補)
- UI 設計: (待補)
- 實裝進度: 0%

### API 需求
```
GET /admin/items - 列表
POST /admin/items - 新增
PATCH /admin/items/:id - 編輯
DELETE /admin/items/:id - 刪除
```

---

## 模塊三：玩家管理 (@player)

### 需求
- 玩家搜尋 & 過濾
- 玩家詳情檢視（等級、裝備、資產）
- 玩家管理（禁言、封禁、重置）
- 玩家交易查詢

### 設計進度
- **UI 設計**: (待補)
- **API 規格**: (待補)
- **實裝進度**: 0%

### API 需求
```
GET /admin/players - 搜尋
GET /admin/players/:id - 詳情
PATCH /admin/players/:id - 編輯
POST /admin/players/:id/ban - 封禁
```

---

## 🔗 協作方式

### 後台設計師
1. 完成 Figma 設計 → 更新本檔案的設計檔案欄
2. 列出 API 需求 → 工程師根據需求實現

### 工程師
1. 看本檔案了解需求
2. 實現 API + 前端元件
3. 更新「實裝進度」

---

## 相關記憶
- [Token 優化策略](TOKEN_OPTIMIZATION.md)
- [Sub Agent 工作流](SUB_AGENT_STRATEGY.md)
- [快速參考](QUICK_REFERENCE.md)

---

**最後更新**: 2026-04-16
