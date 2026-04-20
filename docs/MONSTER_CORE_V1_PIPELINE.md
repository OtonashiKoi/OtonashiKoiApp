# Monster Core v1 Pipeline

Last updated: 2026-04-19

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

