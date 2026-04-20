---
name: otonashisekai.md 自動加載配置
description: otonashisekai.md DB快照已配置自動加载，会话开始时自动执行更新
type: feedback
---

# otonashisekai.md 自動加載配置 ✅

## 配置狀態

**已配置自動加載** ✅

每次 Claude 會話開始時，會自動執行：
```bash
node scripts/generate-skill-snapshot.js
```

## 配置位置

- **CLAUDE.md** — 會話開始指令
- **.claude/settings.json** — Hook 配置 (autoLoadSkillSnapshot)

## 自動執行流程

```
會話開始
  ↓
系統執行: node scripts/generate-skill-snapshot.js
  ↓
生成 otonashisekai.md (94 件道具、24 隻怪物、20 個 NPC事件)
  ↓
Claude 開始對話，otonashisekai.md 已是最新快照
```

## 更新內容

自動更新的 otonashisekai.md 包含：
- **道具庫** — 所有 items collection 資料
- **怪物庫** — 所有 monsters collection 資料  
- **NPC事件** — 所有 monsterEvents collection 資料
- **NPC模板檔** — scripts/npc-templates-clean/ 清單
- **玩家Schema** — players + progress 欄位結構
- **快速查詢指令** — MongoDB 查詢範例

## 若自動執行失敗

若系統未自動執行（網絡問題、MongoDB 不可用等），手動執行：

```bash
node scripts/generate-skill-snapshot.js
```

即可快速更新 otonashisekai.md。

**建檔日期**: 2026-04-16  
**維護**: AI Agent 自動化系統  
**同步週期**: 每次會話開始
