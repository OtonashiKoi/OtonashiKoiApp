# AGENTS Instructions

## Archive Policy
- `archive/` is an archive area.
- Do not read, search, analyze, modify, or use files under `archive/**` unless the user explicitly asks for it.
- If archive content is needed for troubleshooting, ask the user first.

## Slimming / Removal Policy
- For any cleanup, removal, or simplification that may delete files, code, dependencies, scripts, or assets:
- Explain what it is used for in plain language.
- Ask for user approval before removing it.
- Default behavior is keep-first, remove-later only after approval.

## Documentation Source of Truth
- Start documentation work from `docs/README.md`; it defines which files describe the current system and which files are only plans or historical snapshots.
- Runtime behavior is decided by executable code and current MongoDB configuration/data. A prose document must never override them.
- `docs/CURRENT_GAME_STATUS.md` is generated from code plus MongoDB. Refresh it with `npm run status:update`; do not hand-edit generated facts.
- After changing player-visible behavior, feature gates, routes, jobs, combat rules, or live-event rules, update the matching current document and run `npm run check:docs`.
- Plans, handoff notes, changelogs, benchmarks, and dated reports are context only. Do not use them as proof of current behavior unless current code confirms the claim.
