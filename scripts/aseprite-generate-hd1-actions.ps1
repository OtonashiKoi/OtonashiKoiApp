param(
  [string]$AsepriteExe = "D:\Program Files (x86)\Steam\steamapps\common\Aseprite\Aseprite.exe",
  [string]$InputPng = "C:\Users\appsk\Downloads\HD1.png",
  [string]$CharacterId = "hd1_priestess",
  [int]$TargetHeight = 320,
  [string]$OutputRoot = "C:\Users\appsk\Documents\Github\equipmentGameGodot\assets\character\generated\hd1_priestess"
)

$ErrorActionPreference = "Stop"

function Assert-Exists {
  param([string]$PathValue, [string]$Label)
  if (-not (Test-Path $PathValue)) {
    throw "$Label not found: $PathValue"
  }
}

Assert-Exists -PathValue $AsepriteExe -Label "Aseprite executable"
Assert-Exists -PathValue $InputPng -Label "Input image"

$luaScript = Join-Path $PSScriptRoot "aseprite_generate_character_actions.lua"
Assert-Exists -PathValue $luaScript -Label "Aseprite Lua script"

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null

$env:ASE_INPUT = $InputPng
$env:ASE_OUTPUT_ROOT = $OutputRoot
$env:ASE_CHARACTER_ID = $CharacterId
$env:ASE_TARGET_HEIGHT = [Math]::Max(96, [Math]::Min(720, $TargetHeight))

& $AsepriteExe -b --script $luaScript

if ($LASTEXITCODE -ne 0) {
  throw "Aseprite CLI failed with code $LASTEXITCODE"
}

$manifest = [ordered]@{
  source = $InputPng
  characterId = $CharacterId
  targetHeight = [Math]::Max(96, [Math]::Min(720, $TargetHeight))
  actions = @(
    @{ name = "idle"; frames = 8 },
    @{ name = "attack"; frames = 8 },
    @{ name = "hit"; frames = 6 },
    @{ name = "death"; frames = 10 },
    @{ name = "skill"; frames = 8 }
  )
  filePattern = "$CharacterId`_<action>_<frame>.png"
  generatedAt = (Get-Date).ToString("s")
} | ConvertTo-Json -Depth 5

Set-Content -Path (Join-Path $OutputRoot "_manifest.json") -Value $manifest -Encoding UTF8

Write-Host "[hd1-actions] generated to: $OutputRoot"
