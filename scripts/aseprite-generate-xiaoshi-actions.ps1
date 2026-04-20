param(
  [string]$AsepriteExe = "D:\Program Files (x86)\Steam\steamapps\common\Aseprite\Aseprite.exe",
  [string]$MonsterId = "c39bdddd-a33d-4e34-8019-d17020a8083b",
  [string]$SourcePng = "C:\Users\appsk\Documents\Github\equipmentGameGodot\assets\monster\generated\xiaoshi_small_slime\idle\c39bdddd-a33d-4e34-8019-d17020a8083b_idle_01.png",
  [string]$OutputRoot = "C:\Users\appsk\Documents\Github\equipmentGameGodot\assets\monster\generated\xiaoshi_small_slime",
  [int]$FrameCount = 6,
  [int]$CanvasSize = 96,
  [string[]]$Actions = @("idle", "attack", "hit", "death", "skill"),
  [switch]$Redraw
)

$ErrorActionPreference = "Stop"

function Assert-Exists {
  param([string]$PathValue, [string]$Label)
  if (-not (Test-Path $PathValue)) {
    throw "$Label not found: $PathValue"
  }
}

Assert-Exists -PathValue $AsepriteExe -Label "Aseprite executable"
if (-not $Redraw) {
  Assert-Exists -PathValue $SourcePng -Label "Source png"
}

$luaScript = Join-Path $PSScriptRoot "aseprite_xiaoshi_actions.lua"
Assert-Exists -PathValue $luaScript -Label "Aseprite Lua script"

$env:ASE_INPUT = $SourcePng
$env:ASE_OUTPUT_ROOT = $OutputRoot
$env:ASE_MONSTER_ID = $MonsterId
$env:ASE_FRAME_COUNT = [Math]::Max(1, [Math]::Min(12, $FrameCount))
$env:ASE_CANVAS_SIZE = [Math]::Max(32, [Math]::Min(512, $CanvasSize))
$env:ASE_ACTIONS = ($Actions -join ",")
$env:ASE_REDRAW = if ($Redraw) { "1" } else { "0" }

& $AsepriteExe -b --script $luaScript

if ($LASTEXITCODE -ne 0) {
  throw "Aseprite CLI failed with code $LASTEXITCODE"
}

$actions = @("idle", "attack", "hit", "death", "skill")
if ($Actions -and $Actions.Count -gt 0) {
  $actions = $Actions
}
foreach ($action in $actions) {
  $dir = Join-Path $OutputRoot $action
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $metaPath = Join-Path $dir "$MonsterId`_$action`_manifest.json"
  $meta = [ordered]@{
    generatedBy = "aseprite_xiaoshi_actions.lua"
    source = $SourcePng
    monsterId = $MonsterId
    action = $action
    frameCount = [Math]::Max(1, [Math]::Min(12, $FrameCount))
    filePattern = "$MonsterId`_$action`_%02d.png"
    transparent = $true
    generatedAt = (Get-Date).ToString("s")
  } | ConvertTo-Json -Depth 4
  Set-Content -Path $metaPath -Value $meta -Encoding UTF8
}

Write-Host "[xiaoshi-actions] generated 5 actions to: $OutputRoot"
