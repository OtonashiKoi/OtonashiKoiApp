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

## Player Restart Notice
- Before any agent-initiated production restart, run `node scripts/pre-pm2-restart-hotfix.js` and verify successful delivery to Discord channel `1498608950671839263`. If delivery fails, do not restart.
- Prefer `npm run pm2:restart`, which runs the notice prehook. Direct PM2 restarts require the same notice first. Static-file-only changes do not require a runtime restart.

## Production Update Workflow
- Before any production update, including work from an older worktree, reread this file in the main checkout at `/Users/riuchen/Documents/otonashiKoi_game/AGENTS.md` and the current deployment section in `docs/SYSTEM_HARDENING.md` there. Do not assume another chat's instructions or an older worktree contain the latest workflow.
- Prepare changes, tests, builds, and any backup/compression work while production remains available, preferably in an isolated worktree. Keep the restart window limited to handing over to the prepared runtime.
- Respect the user's release approval boundary. If review/approval is pending, keep changes in testing until approval is given; an approval already given for the release need not be requested again.
- For an authorized backend release, follow the restart notice rule above and use `npm run pm2:restart` to restart only `equipmentGAME`. Keep `equipmentGateway` and `cloudflared` running during routine releases. Do not use `pm2 restart all`, or stop the gateway/tunnel as part of an ordinary game update.
- Preserve the gateway pause/drain/resume handshake and single-runtime lease protection. Do not delete or prematurely expire a lease to bypass startup waiting. Do not launch a test runtime against the production database or use start/dev prehooks that free production port 5566.
- For static SPA updates, build in `equipmentGAME-app` and use its atomic release workflow (`npm run build`, then `npm run deploy:no-build`); no backend restart is needed.
- Verify local and public health, relevant production APIs, and the updated player-facing behavior after release. During backend handover, record request errors and wait times; for static releases, verify served asset hashes. Report measured results without promising zero interruption or uninterrupted in-memory battles.
