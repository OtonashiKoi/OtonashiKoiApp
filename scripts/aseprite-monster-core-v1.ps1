param(
  [string]$AsepriteExe = "D:\Program Files (x86)\Steam\steamapps\common\Aseprite\Aseprite.exe",
  [string]$MonsterDir = "C:\Users\appsk\Documents\Github\equipmentGameGodot\assets\monster\01",
  [string]$OutputDirName = "core_v1",
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

Assert-Exists -PathValue $AsepriteExe -Label "Aseprite executable"
Assert-Exists -PathValue $MonsterDir -Label "Monster directory"

$gif = Get-ChildItem -Path $MonsterDir -File -Filter *.gif | Select-Object -First 1
if (-not $gif) {
  throw "No .gif found in $MonsterDir"
}

$outputRoot = Join-Path $MonsterDir $OutputDirName
$idleDir = Join-Path $outputRoot "idle"
$attackDir = Join-Path $outputRoot "attack"
$hitDir = Join-Path $outputRoot "hit"
$deathDir = Join-Path $outputRoot "death"
$skillDir = Join-Path $outputRoot "skill"

if ($ValidateOnly) {
  Write-Host "[monster-core-v1] validation OK"
  Write-Host "AsepriteExe : $AsepriteExe"
  Write-Host "MonsterDir  : $MonsterDir"
  Write-Host "SourceGif   : $($gif.FullName)"
  Write-Host "OutputRoot  : $outputRoot"
  exit 0
}

New-Item -ItemType Directory -Force -Path $idleDir, $attackDir, $hitDir, $deathDir, $skillDir | Out-Null

$idleSheet = Join-Path $idleDir "monster01_idle_sheet.png"
$idleJson = Join-Path $idleDir "monster01_idle_sheet.json"

& $AsepriteExe `
  -b $gif.FullName `
  --sheet $idleSheet `
  --data $idleJson `
  --format json-array `
  --sheet-pack `
  --trim `
  --extrude `
  --border-padding 2 `
  --shape-padding 2

# Build playable placeholders for missing actions (from idle export).
Copy-Item -Path $idleSheet -Destination (Join-Path $attackDir "monster01_attack_sheet.placeholder.png") -Force
Copy-Item -Path $idleJson -Destination (Join-Path $attackDir "monster01_attack_sheet.placeholder.json") -Force
Copy-Item -Path $idleSheet -Destination (Join-Path $hitDir "monster01_hit_sheet.placeholder.png") -Force
Copy-Item -Path $idleJson -Destination (Join-Path $hitDir "monster01_hit_sheet.placeholder.json") -Force
Copy-Item -Path $idleSheet -Destination (Join-Path $deathDir "monster01_death_sheet.placeholder.png") -Force
Copy-Item -Path $idleJson -Destination (Join-Path $deathDir "monster01_death_sheet.placeholder.json") -Force
Copy-Item -Path $idleSheet -Destination (Join-Path $skillDir "monster01_skill_sheet.placeholder.png") -Force
Copy-Item -Path $idleJson -Destination (Join-Path $skillDir "monster01_skill_sheet.placeholder.json") -Force

$notice = @"
Monster 01 Core v1
Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

Current source status:
- Only one source GIF is available.

Output status:
- idle: real export from source GIF
- attack/hit/death/skill: placeholders copied from idle

Next step:
- Replace placeholder sheets with dedicated action sprites once available.
"@

Set-Content -Path (Join-Path $outputRoot "PLACEHOLDER_NOTICE.txt") -Value $notice -Encoding UTF8

Write-Host "[monster-core-v1] generated:"
Write-Host "  idle real export + action placeholders"
Write-Host "  root: $outputRoot"
