---
name: ui-ux-pro-max
description: 後台 UI 設計或改版時使用——BM25 搜尋式設計系統、色彩方案、組件規範、動畫規則。含 HTML/Tailwind 技術棧支援。
when_to_use: 設計或改版後台 Admin UI、需要配色方案、組件樣式規範、或響應式設計指引時使用。
---

# UI/UX Pro Max

此 Skill 提供後台 UI 設計的系統化參考，包含設計風格搜尋與組件規範。

## 技術棧

本專案後台使用 **原生 HTML + CSS**（無框架），設計時參考 `data/stacks/html-tailwind.csv` 的規範。

## 設計原則

- 深色主題（背景 `#0f172a`，卡片 `#1e293b`）
- 主強調色 `var(--accent, #4ade80)`（綠色）
- 危險操作用 `#ef4444`（紅色）
- 字型：系統字體堆疊
- 圓角統一 `8px`
- 過渡動畫 `0.2s ease`

## 常用組件規範

### 按鈕
```css
.btn-primary { background: var(--accent); color: #0f172a; padding: 8px 16px; border-radius: 8px; }
.btn-danger  { background: #ef4444; color: white; }
.btn-ghost   { background: transparent; border: 1px solid rgba(255,255,255,0.15); color: white; }
```

### 卡片
```css
.card { background: #1e293b; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 16px; }
```

### 表格
- 奇數行 `rgba(255,255,255,0.03)` 斑馬紋
- hover `rgba(255,255,255,0.06)`
- 表頭 `rgba(255,255,255,0.05)` + 小寫字母間距

### Tab 切換
```css
.tab.active { background: var(--accent); color: #0f172a; }
.tab        { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.7); }
```

## Zone 色彩字典（怪物區）

| zone | 色彩 |
|---|---|
| beginner | `#2ecc71` |
| normal | `var(--accent, #4ade80)` |
| mid | `#7c3aed` |
| hard | `#f97316` |
| elite | `#ef4444` |

## 參考資料

- 設計風格資料：`data/stacks/html-tailwind.csv`
- 色彩方案腳本：`scripts/search.py`
