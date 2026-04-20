# MEMORY BOOTSTRAP (Codex)

Updated: 2026-04-19

## First-Read Order Per New Session

1. `MEMORY.md`
2. `session_checkpoint.md`
3. `feedback_context_save_policy.md`
4. `FEEDBACK_COMMUNICATION_LANG.md`
5. `QUICK_REFERENCE.md`

## Domain-Specific Read Add-ons

- Attributes or combat speed changes:
`ATTRIBUTES_SYSTEM.md`, `AGI_COMBAT_SPEED.md`
- Job logic:
`JOB_MECHANICS_IMPLEMENTATION.md`
- Buff/debuff or effect logic:
`BUFF_DEBUFF_REFERENCE.md`, `MONSTER_CARD_SKILL_SYSTEM.md`
- Enhance flow:
`EQUIPMENT_ENHANCE_SYSTEM.md`, `ENHANCE_GEMS.md`
- Admin or Discord profile behavior:
`DC_PROFILE_SYSTEM.md`, `ADMIN_SYSTEM_SPECS.md`

## Token-Control Defaults

- Keep context compact: load only files relevant to the current task.
- Rebuild memory snapshot weekly:
refresh `session_checkpoint.md` and `MEMORY.md`.
- Save checkpoint when task is interrupted or handoff is likely.
