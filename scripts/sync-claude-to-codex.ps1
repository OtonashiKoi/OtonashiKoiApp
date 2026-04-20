$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceSkills = Join-Path $repoRoot ".claude/skills"
$targetSkills = Join-Path $repoRoot ".claude/codex-sync/skills"

$sourceMemory = "C:\Users\appsk\.claude\projects\c--Users-appsk-Documents-Github-equipmentGAME\memory"
$targetMemory = Join-Path $repoRoot ".claude/codex-sync/memory"

New-Item -ItemType Directory -Force -Path $targetSkills | Out-Null
New-Item -ItemType Directory -Force -Path $targetMemory | Out-Null

Copy-Item -Path (Join-Path $sourceSkills "*") -Destination $targetSkills -Recurse -Force
Copy-Item -Path (Join-Path $sourceMemory "*") -Destination $targetMemory -Recurse -Force

Write-Host "[sync-claude-to-codex] done"
Write-Host "skills => $targetSkills"
Write-Host "memory => $targetMemory"
