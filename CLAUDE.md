# equipmentGAME — AI 協作指南

> 本檔案供 Claude Code 和 Codex 共用。新對話開始時先讀這裡，有需要再查 memory/ 細節。

---

## 工作流規範

### Token 節省規則
- **對話到 90%** → 主動把進度存進 memory/session_checkpoint.md，再繼續
- **完成任務後 3 分鐘無回覆** → 自動更新 session_checkpoint.md
- **每次新對話** → 先讀 session_checkpoint.md，再決定要不要讀其他記憶

### 溝通規範
- 所有需要決策、許可、詢問用戶的事項，**一律用繁體中文**
- 回覆要簡潔，不要在結尾重複摘要已做的事

### PM2 規範
- PM2 啟動由用戶自己負責，Claude 不要主動啟動
- 需要重啟告知用戶用 `npm run pm2:reset`

### Worktree 規範
- 使用 worktree 時只改應用代碼，PM2 和 .env 要改主目錄
- 完成推送和生產環境測試後必須合併 worktree

---

## 技術架構

### 儲存層
- **MongoDB**：`mongodb://localhost:27017`，DB：`equipment_game`
- 統一 MongoDB，已移除 JSON 檔案和環境變數開關
- `item.id` 是 UUID（系統使用），`item._id` 是 MongoDB hex string（兩者不同，不要混用）

### 主要目錄結構
```
src/
  api/routes/          # Express 路由
  bot/                 # Discord Bot
    handlers/          # 事件處理器
    monsterZoneView.js # 怪物區面板視圖
  services/            # 業務邏輯
  shared/              # 共用模組
    zones.js           # Zone 常數單一來源 ← 重要
    effectEngine.js    # 戰鬥效果引擎
    combatStats.js     # 戰鬥數值計算
  web/public/          # 後台前端
scripts/               # 維護腳本
```

### Zone 系統（5 個區域）
| zone key | featureKey | 名稱 | 等級限制 |
|---|---|---|---|
| `beginner` | `monster_zone_beginner` | 🌱 新手區 | Lv.1–3 |
| `normal` | `monster_zone` | ⚔️ 一般區 | Lv.1–10 |
| `mid` | `monster_zone_mid` | ✦ 中級區 | Lv.10+ |
| `hard` | `monster_zone_hard` | 🔥 高級區 | Lv.20+ |
| `elite` | `monster_zone_elite` | 💀 精英區 | Lv.30+ |

- 所有 zone 相關邏輯統一從 `src/shared/zones.js` import，不要 hardcode
- 等級限制優先讀 channel layout binding（後台可改），fallback 到 zones.js 靜態設定

### 屬性系統
- 六大屬性：STR / AGI / VIT / INT / DEX / LUK，上限 60
- AGI 40 達最快攻速 0.5s/回合
- 設計任何屬性相關功能必查 `memory/ATTRIBUTES_SYSTEM.md`，改完要同步更新該檔

### 裝備強化系統
- `enhanceLevel` 存在裝備上，equipStats 要動態計算（base + enhanceLevel）
- `effectEngine.js` 的 `mergeEquippedFromLibrary()` 會動態套用強化數值
- `shopService.equipItem()` 不覆蓋 equipStats
- itemId 要用 UUID（`item.id`），不要用 MongoDB `_id`

---

## 職業系統（7 個職業）
已完整實裝，詳見 `memory/JOB_MECHANICS_IMPLEMENTATION.md`

| 職業 | 核心機制 |
|---|---|
| 戰士 | 高 STR/VIT，普通攻擊 |
| 法師 | INT 魔法傷害 |
| 弓箭手 | DEX 命中要害，可與爆擊疊加 |
| 盜賊 | AGI 高閃避 + 連擊 |
| 聖騎士 | VIT 防禦 + 治癒 |
| 治療師 | 「在場」光環，跨玩家效果 |
| 格鬥家 | LUK 暴擊 |

---

## 上次工作進度

> 詳見 `memory/session_checkpoint.md`（每次工作後自動更新）

**最近完成（2026-04-19）：**
1. 怪物區從 2 個擴充到 5 個 zone（完整程式碼修改）
2. Zone 面板等級限制可在後台 binding 設定覆蓋
3. 新手區 5 隻怪物、高級區 15 隻古城風格怪物已寫入 DB

**待辦：**
- 中級區（mid）和精英區（elite）怪物尚未新增
- 後台綁定新手區/高級區頻道後需要發布面板

---

## 常用指令
```bash
npm run pm2:reset        # 重啟服務
npm run workflow:finalize # 驗證、測試、提交、清理
node scripts/insert-new-zone-monsters.js  # 新增新手/高級區怪物
```

## 常用 Skills（開發時主動使用）
- `/admin-backend-development` — 後台新功能（怪物/道具/任務管理）
- `/mongodb-standard` — 任何新增 Collection 或查詢
- `/discord-commands-convention` — 新增 Discord 按鈕/指令/互動

## 重要記憶索引
詳細規格查 `memory/` 目錄，MEMORY.md 有完整索引：
- `ATTRIBUTES_SYSTEM.md` — 屬性公式、上限、職業綁定
- `BUFF_DEBUFF_REFERENCE.md` — 所有 Buff/Debuff key 表
- `EQUIPMENT_ENHANCE_SYSTEM.md` — 強化規則完整規格
- `MONSTER_CARD_SKILL_SYSTEM.md` — 24 張卡片技能框架
- `session_checkpoint.md` — 上次工作暫存（**每次新對話先讀**）
