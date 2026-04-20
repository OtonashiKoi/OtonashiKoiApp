param(
  [string]$ManifestPath = "c:\Users\appsk\Documents\Github\equipmentGAME\docs\MONSTER_LINEUP_V1_MANIFEST.json",
  [string]$GodotMonsterRoot = "C:\Users\appsk\Documents\Github\equipmentGameGodot\assets\monster\generated",
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"

function Assert-Exists {
  param(
    [string]$PathValue,
    [string]$Label
  )
  if (-not (Test-Path $PathValue)) {
    throw "$Label not found: $PathValue"
  }
}

Assert-Exists -PathValue $ManifestPath -Label "Manifest"

$manifestRaw = Get-Content $ManifestPath -Raw -Encoding UTF8
$manifest = $manifestRaw | ConvertFrom-Json

if (-not $manifest.monsters -or $manifest.monsters.Count -eq 0) {
  throw "Manifest has no monsters."
}

if ($ValidateOnly) {
  Write-Host "[prepare-lineup-v1] validation OK"
  Write-Host "Manifest: $ManifestPath"
  Write-Host "Count   : $($manifest.monsters.Count)"
  Write-Host "OutRoot : $GodotMonsterRoot"
  exit 0
}

New-Item -ItemType Directory -Force -Path $GodotMonsterRoot | Out-Null

$actions = @("idle", "attack", "hit", "death", "skill")
$tasks = @()

foreach ($m in $manifest.monsters) {
  $id = [string]$m.id
  $name = [string]$m.name
  $zone = [string]$m.zone
  $level = [int]$m.level
  $species = [string]$m.species
  $traits = @($m.traits | ForEach-Object { [string]$_ })

  $monsterRoot = Join-Path $GodotMonsterRoot $id
  New-Item -ItemType Directory -Force -Path $monsterRoot | Out-Null

  foreach ($a in $actions) {
    $adir = Join-Path $monsterRoot $a
    New-Item -ItemType Directory -Force -Path $adir | Out-Null

    $placeholder = [ordered]@{
      id = $id
      name = $name
      action = $a
      zone = $zone
      level = $level
      species = $species
      traits = $traits
      targetPath = $adir
      expectedPattern = "${id}_${a}_01.png"
    }
    $tasks += [PSCustomObject]$placeholder
  }
}

$taskOut = Join-Path $GodotMonsterRoot "_lineup_v1_tasks.json"
$tasks | ConvertTo-Json -Depth 8 | Set-Content -Path $taskOut -Encoding UTF8

$readme = @"
Monster Lineup v1 Task Pack
Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Manifest : $ManifestPath
OutRoot  : $GodotMonsterRoot
Monsters : $($manifest.monsters.Count)
Actions  : $($actions -join ', ')

Output:
- Per-monster folders created under generated/<monster_id>/
- Action folders: idle/attack/hit/death/skill
- Task list JSON: _lineup_v1_tasks.json

Naming convention:
- <monster_id>_<action>_01.png
"@

Set-Content -Path (Join-Path $GodotMonsterRoot "_lineup_v1_README.txt") -Value $readme -Encoding UTF8

Write-Host "[prepare-lineup-v1] done"
Write-Host "Root : $GodotMonsterRoot"
Write-Host "Tasks: $taskOut"

