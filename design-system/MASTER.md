# 設計系統 — 後台 (白色基底)

目標：為 equipmentGAME 的後台提供一套乾淨、舒服且以白色為基底的 UI/UX 設計系統，優先考量可讀性、可訪問性與維護性。

## 設計原則
- 白色為主要畫布：淺色背景、柔和陰影、清晰層級。
- 空間感：使用一致的間距系統讓資訊呼吸（以 4px 為基礎刻度）。
- 可訪問性優先：文字對比 >= 4.5:1、明顯 focus 樣式、鍵盤導覽。
- 視覺層次：使用 subtle border 與 soft shadow 代替強烈顏色分層。

## 色彩系 (白色基底)
- 背景：`#FFFFFF` (white)
- 版面淺層 (surface): `#F8FAFC` (slate-50)
- 卡片背景：`#FFFFFF`
- 主要文字：`#0F172A` (slate-900)
- 次要文字：`#475569` (slate-600)
- 邊框：`#E6E9EE` (gray-200)
- 主要色 (Primary)：`#2563EB` (blue-600)
- 次要色 (Accent)：`#06B6D4` (cyan-500)
- 成功：`#16A34A` (green-600)
- 危險：`#EF4444` (red-500)
- 警示：`#F59E0B` (amber-500)

註：若使用 Tailwind，對應 tokens 可設定為 `--color-bg`, `--color-surface`, `--color-ink`, `--color-primary` 等。

## 排版
- 字體：建議 `Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial`。
- 文字基底：`16px` (Tailwind `text-base`)。
- 行高：正文 1.5；標題 1.25。
- 尺寸參考：h1 32px, h2 24px, h3 20px, body 16px, small 12px。

## 間距尺度（以 4px 為單位）
- xs: 4px (0.25rem)
- sm: 8px (0.5rem)
- md: 16px (1rem)
- lg: 24px (1.5rem)
- xl: 32px (2rem)

## 版面配置範式
- 全域：固定頂欄 + 可收折側欄 + 主內容容器（max-w-6xl 居中，左右 padding md).
- 卡片：白色卡片、輕微圓角（6px）、邊框 `#E6E9EE`、陰影 `0 1px 2px rgba(15,23,42,0.04)`。
- 表格：行間距略大、可選擇行 hover 背景 `#F8FAFC`、行動裝置呈現為卡片清單。

## 元件指南（要點）
- 按鈕：主按鈕 `bg-primary text-white rounded-md px-4 py-2`，hover 時 `bg-primary-700`，disabled 用 `bg-gray-100 text-gray-400`。
- 導覽列：淺色半透明陰影，LOGO 左側、使用者與動作群組右側。
- 側欄：可收折；主選單使用 icon + label；選中行用 `bg-surface` 並加左側 3px accent bar。
- 表單：label 在上方，輸入框 `border-gray-200 rounded-md px-3 py-2`，錯誤提示紅色並置於欄位下方。
- 卡片群組：卡片間距 `md`，卡片內標題 bold、文字使用次要文字色。

## 無障礙要點
- 文字對比 >= 4.5:1（主要文字對背景）
- 所有 icon-only buttons 加 `aria-label`
- keyboard: 所有互動元素必須有 focus 樣式（outline 或 ring）
- respects `prefers-reduced-motion`

## 常見反模式
- 不要以透明度過高的白色文字作為主要內容（會降低可讀性）。
- 不要在 hover 以 scale 改變整體排版（會造成 layout shift）。

## 實作範例（快速原型，使用 Tailwind CDN）
參考檔案： [design-system/preview/dashboard.html](design-system/preview/dashboard.html)

---
如需將此設計整合到專案建構流程，我建議在 `player-web` 中新增 Tailwind（或在主佈署流程中加入 CSS 編譯），但原型可先使用 CDN 作快速驗證。
