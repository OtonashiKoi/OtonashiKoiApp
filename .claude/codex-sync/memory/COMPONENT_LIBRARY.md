---
name: 組件庫 (Component Library)
description: 可重用 UI 組件設計規格 - 自動加載，減少重複設計
type: project
originSessionId: 79c1604f-834b-4dfa-a16d-7ed599900fc9
---
# 組件庫

**狀態**: 📝 初始化中  
**用途**: 設計師快速組合 UI，工程師快速實現  
**自動加載**: 是

---

## 📦 組件列表

### 基礎組件 (Base Components)

#### Button 按鈕
```
變體: Primary / Secondary / Danger / Disabled
大小: Small (32px) / Medium (40px) / Large (48px)
圖示: 支援左/右圖示
狀態: Normal / Hover / Active / Disabled
```
**使用場景**: 表單提交、操作確認、菜單項

#### Input 輸入框
```
類型: Text / Email / Password / Number
狀態: Default / Focus / Error / Disabled
圖示: 支援前綴/後綴圖示
提示: Label + Placeholder + Helper text
```
**使用場景**: 搜尋、表單欄位

#### Select 下拉選擇
```
單選 / 多選
可搜尋
虛擬滾動（大列表）
```
**使用場景**: 職業選擇、伺服器選擇

#### Checkbox / Radio
```
Label / 獨立使用
Indeterminate 狀態（用於全選）
```
**使用場景**: 篩選、批量操作

#### Tag / Badge 標籤
```
顏色: 各系統色
大小: Small / Medium
可移除
```
**使用場景**: 玩家等級、道具稀有度、狀態標籤

---

### 佈局組件 (Layout Components)

#### Card 卡片
```
基礎卡片: Header / Body / Footer
互動卡片: Hover + 陰影變化
響應式: 桌面/平板/手機
```
**使用場景**: 玩家卡片、道具卡片、統計面板

#### Modal 彈窗
```
大小: Small / Medium / Large
內容: Header / Body / Footer
按鈕: 確認/取消
```
**使用場景**: 確認對話、表單彈窗

#### Tabs 標籤頁
```
橫向 / 縱向
可拖拽
懶加載內容
```
**使用場景**: 玩家資訊頁（基礎資訊/裝備/成就）

#### Sidebar 側邊欄
```
可折疊
菜單項: 圖示 + 文字
活躍狀態
```
**使用場景**: 後台導航

#### Pagination 分頁
```
頁碼選擇
跳轉輸入框
上/下一頁按鈕
```
**使用場景**: 玩家列表、道具列表

---

### 資訊展示 (Data Display)

#### Table 表格
```
固定表頭
可排序
可篩選
行操作（編輯/刪除）
批量操作
```
**使用場景**: 玩家列表、道具表、交易紀錄

#### Stat Card 統計卡
```
標題 / 數值 / 變化趨勢
圖表迷你版
```
**使用場景**: 儀表板統計區

#### Progress 進度條
```
線性進度
環形進度
百分比顯示
```
**使用場景**: 等級進度、任務進度

#### Avatar 頭像
```
圖片 / 首字母 / 圖示
大小: XS / S / M / L / XL
線上狀態指示
```
**使用場景**: 玩家頭像、用戶列表

---

### 反饋組件 (Feedback)

#### Alert 提示
```
類型: Success / Warning / Error / Info
可關閉
圖示 + 標題 + 描述
```
**使用場景**: 操作結果、系統通知

#### Toast 吐司通知
```
位置: 右上角
自動消失（3-5 秒）
堆疊顯示
```
**使用場景**: 快速操作反饋

#### Loading 加載
```
骨架屏 (Skeleton)
旋轉加載圈
進度條
```
**使用場景**: 資料加載、異步操作

#### Empty State 空狀態
```
圖示 + 標題 + 描述
操作按鈕
```
**使用場景**: 無資料、無結果

---

## 🎨 組件狀態矩陣

| 組件 | Default | Hover | Active | Disabled | Loading | Error |
|------|---------|-------|--------|----------|---------|-------|
| Button | ✓ | ✓ | ✓ | ✓ | ✓ | - |
| Input | ✓ | ✓ | ✓ | ✓ | - | ✓ |
| Select | ✓ | ✓ | ✓ | ✓ | - | - |
| Card | ✓ | ✓ | - | - | - | - |
| Modal | ✓ | - | - | - | - | - |

---

## 📋 設計師使用指南

### 快速設計
```
[畫] @admin 後台儀表板
參考：
- COMPONENT_LIBRARY.md → 選擇 Stat Card
- DESIGN_SYSTEM.md → 確認色彩
→ 3 分鐘完成設計
```

### 新組件
```
如果現有組件無法滿足需求：
[設計] 新組件 "玩家互動卡片"
  → 定義外觀 & 交互
  → 更新本檔案
  → 工程師實現
```

---

## 🔗 工程師實現清單

待實現的組件：

- [ ] Button (所有變體)
- [ ] Input (所有類型)
- [ ] Select (單選/多選)
- [ ] Card (基礎/互動)
- [ ] Modal (確認/表單)
- [ ] Table (完整版)
- [ ] Tabs
- [ ] Sidebar
- [ ] Avatar
- [ ] Badge
- [ ] Alert
- [ ] Toast
- [ ] Loading (骨架屏)

**進度**: 0% → 100%

---

## 📚 相關記憶

- [設計系統](DESIGN_SYSTEM.md) - 色彩、排版、規則
- [後台 UI 規格](ADMIN_UI_SPECS.md) - 後台系統設計
- [簡單工作流](../SIMPLE_WORKFLOW.md) - 協作方式

---

**最後更新**: 2026-04-16  
**組件總數**: 25+  
**實現進度**: 0%
