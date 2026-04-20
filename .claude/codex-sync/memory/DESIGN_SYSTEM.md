---
name: 設計系統 (Design System)
description: 全局色彩、排版、組件基礎樣式 - UI/UX 設計師主要維護
type: project
originSessionId: 79c1604f-834b-4dfa-a16d-7ed599900fc9
---
# 遊戲設計系統

**狀態**: 📝 初始化中  
**維護者**: UI/UX 設計師  
**同步方式**: 自動加載到 Memory

---

## 🎨 色彩系統

### 主色盤
```
主色 (Primary):     #2563eb (藍)
次色 (Secondary):   #64748b (灰)
成功 (Success):     #10b981 (綠)
警告 (Warning):     #f59e0b (橙)
危險 (Danger):      #ef4444 (紅)
```

### 背景
```
背景深色: #0f172a (遊戲主色)
背景淺色: #f8fafc (後台面板)
邊框色:   #e2e8f0
```

### 文字
```
文字深:   #1e293b
文字淺:   #64748b
文字禁用: #cbd5e1
```

---

## 📐 排版系統

### 字體
```
標題字體:  PingFang SC / Noto Sans CJK (中文)
正文字體:  -apple-system, Segoe UI (英文)
等寬字體:  Fira Code (代碼顯示)
```

### 大小規格
```
超大標題:  32px (h1)
大標題:    24px (h2)
標題:      20px (h3)
副標題:    16px (h4)
正文:      14px
小字:      12px
說明:      11px
```

### 行高
```
標題:  1.2
正文:  1.6
密集:  1.4
```

---

## 🏗️ 間距系統

```
超小:  4px
小:    8px
中:    16px
大:    24px
超大:  32px
```

**應用**:
- Card padding: 16px
- Page margin: 24px
- Element gap: 8px

---

## 🎛️ 陰影系統

```
浅陰影:  0 1px 2px rgba(0,0,0,0.05)
中陰影:  0 4px 6px rgba(0,0,0,0.1)
深陰影:  0 10px 15px rgba(0,0,0,0.15)
```

---

## 🔘 組件基礎樣式

### 按鈕
```
主按鈕:
- 背景: #2563eb
- 文字: 白色
- Padding: 8px 16px
- Border-radius: 6px
- Hover: #1d4ed8

次按鈕:
- 背景: #e2e8f0
- 文字: #1e293b
- Hover: #cbd5e1

危險按鈕:
- 背景: #ef4444
- 文字: 白色
- Hover: #dc2626
```

### 輸入框
```
邊框: #e2e8f0
背景: 白色
Padding: 8px 12px
Border-radius: 6px
Font-size: 14px

Focus:
- 邊框: #2563eb
- Box-shadow: 0 0 0 3px rgba(37,99,235,0.1)
```

### 卡片
```
背景: 白色
邊框: 1px solid #e2e8f0
陰影: 浅陰影
Border-radius: 8px
Padding: 16px
```

### 標籤 (Badge)
```
背景: #dbeafe (藍)
文字: #1e40af (深藍)
Padding: 4px 8px
Border-radius: 4px
Font-size: 12px
```

---

## 📱 響應式規則

```
Mobile:     < 640px (縮放所有間距 × 0.75)
Tablet:     640px - 1024px (正常)
Desktop:    > 1024px (正常)
Large:      > 1440px (擴展 × 1.25)
```

---

## 🎭 暗黑模式

```
背景深:    #1e293b → #0f172a
背景淺:    #f8fafc → #1e293b
文字深:    #1e293b → #f8fafc
文字淺:    #64748b → #cbd5e1
邊框:      #e2e8f0 → #334155
```

---

## ✨ 動畫規則

```
快速: 150ms (懸停、焦點)
中速: 300ms (轉場、展開)
慢速: 500ms (重要通知)

緩動函數:
- 進入: cubic-bezier(0.34, 1.56, 0.64, 1)
- 退出: cubic-bezier(0.25, 0.46, 0.45, 0.94)
```

---

## 🔗 使用指南

### 設計師
1. **新設計時參考本檔案**
   - 色彩 → 使用主色盤
   - 排版 → 使用大小規格
   - 間距 → 使用間距系統

2. **更新規範時**
   - 編輯本檔案
   - 新增色彩 / 修改字體 → 記錄原因

### 工程師
1. **實現設計時參考本檔案**
   - CSS 變數設置
   - Tailwind 配置
   - 主題配置

2. **實現後反饋**
   - 是否有無法實現的規則
   - 是否需要調整

---

## 📋 設計系統清單

待建立：
- [ ] 色彩定義 ✅ 已完成
- [ ] 排版規則 ✅ 已完成
- [ ] 組件樣式 ✅ 已完成
- [ ] Figma 組件庫
- [ ] CSS 變數檔案
- [ ] Tailwind 主題配置
- [ ] 暗黑模式主題

---

**最後更新**: 2026-04-16  
**下次審查**: 2026-05-01
