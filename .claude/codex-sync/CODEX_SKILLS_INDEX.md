# Codex Skills Sync Index

Updated: 2026-04-19

This folder is a Codex-side mirror of Claude skills and memory for `equipmentGAME`.

## Synced Skill Packs

- `admin-backend-development`
- `discord-commands-convention`
- `game-api-reference`
- `mongodb-standard`
- `performance-optimization`
- `token-optimization`
- `ui-ux-pro-max`

## Location

- Skills mirror: `.claude/codex-sync/skills`
- Memory mirror: `.claude/codex-sync/memory`
- Codex-compatible setting map: `.claude/codex-sync/codex-compatible-settings.json`
- Re-sync command: `pwsh -File scripts/sync-claude-to-codex.ps1`

## Usage Notes

- Prioritize `game-api-reference` before implementing new routes/services.
- Use `mongodb-standard` for any collection, index, or repository changes.
- Use `discord-commands-convention` for slash command, button, select, and modal behavior.
- Use `token-optimization` + memory files for long task context control.

## Known Limitation

- Repository `.codex/` path is currently read-only in this environment, so sync output is stored under `.claude/codex-sync/`.
- Extra skill roots `.agent/skills` and `.agents/skills` were scanned; no usable `SKILL.md` manifests were found there in this repo snapshot.
