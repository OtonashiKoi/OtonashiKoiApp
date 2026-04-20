---
name: otonashisekai.md DB快照規則
description: 每次會話開始必須執行 generate-skill-snapshot.js 更新 otonashisekai.md，道具/怪物/NPC設計優先查 otonashisekai.md
type: feedback
---

# otonashisekai.md — DB 快照規則

## 規則

**每次 Claude Code 會話開始時，必須先執行：**

```bash
node scripts/generate-skill-snapshot.js
```

這會更新專案根目錄的 `otonashisekai.md`，內容包含從 MongoDB 讀取的最新快照。

## otonashisekai.md 包含的資料

| 資料類型 | 來源 Collection | 說明 |
|---------|----------------|------|
| 道具/裝備 | `items` | 所有道具 ID、名稱、欄位、等級、武器種 |
| 怪物庫 | `monsters` | 所有怪物 ID、名稱、zone、HP、ATK |
| NPC 事件 | `monsterEvents` | 所有 NPC 事件 ID、名稱、zone |
| NPC 模板檔 | 檔案系統 `scripts/npc-templates-clean/` | 模板 JSON 清單 |
| 玩家 Schema | `players` + `progress` | 欄位結構 |

## ⚠️ 設計規範

**設計道具、NPC、怪物之前必須查 otonashisekai.md，使用真實存在的 ID。**

**Why:** 曾因虛擬道具 ID 設計 20 個 NPC，全部要重改。

**How to apply:** 任何涉及 itemId、monsterId 的設計，先開 otonashisekai.md 確認存在。

## NPC 模板特殊說明

- **模板定義**：`scripts/npc-templates-clean/*.json`（檔案系統）
- **DB 記錄**：`monsterEvents` collection（透過後台 reload-templates 匯入）
- DB 才是唯一真相，模板檔是定義源

**建檔日期**: 2026-04-16
