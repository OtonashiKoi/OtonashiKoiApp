# Monster Core v1 Pipeline

> ⛔ **歷史文件（2026-08-07 審計標記）**：本文件描述的是舊 Windows 機（`C:\Users\appsk\...`）上的
> Aseprite/Godot 素材 pipeline，現行環境為 macOS，路徑與 pwsh 腳本皆不可用。僅存檔備查，
> 若 Godot 線重啟需整份重寫。

Last updated: 2026-04-19

> ⚠️ **過時提示（2026-05-21）**：本文件未涵蓋：
> - 世界王（World Boss）的週循環與多階段機制 — 詳見 `src/services/worldBoss/worldBossService.js`
> - 爬塔（Tower）boss 的特殊行為與祝福效果 — 詳見 `src/bot/handlers/towerHandlers.js`
>
> 新系統索引請見 [`NEW_SYSTEMS_V1_INDEX.md`](./NEW_SYSTEMS_V1_INDEX.md)。

## Goal

Create a playable Monster 01 core animation package from current assets, with explicit placeholder handling for missing actions.

## Current Input Reality

- `assets/monster/01` currently has one `.gif` source.
- That allows real export for one action baseline (`idle`), but not unique attack/hit/death/skill yet.

## Script

Run:

```powershell
pwsh -File scripts/aseprite-monster-core-v1.ps1
```

Validation only:

```powershell
pwsh -File scripts/aseprite-monster-core-v1.ps1 -ValidateOnly
```

## Output

Generated under:

`C:\Users\appsk\Documents\Github\equipmentGameGodot\assets\monster\01\core_v1`

Folders:

- `idle` (real exported sheet/json)
- `attack` (placeholder)
- `hit` (placeholder)
- `death` (placeholder)
- `skill` (placeholder)

## Next Upgrade Path (v2)

Once dedicated action sources exist:

1. Replace placeholder files per action.
2. Keep same naming pattern to avoid game-side loader changes.
3. Regenerate only changed action bundles.

