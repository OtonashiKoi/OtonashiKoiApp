param(
  [string]$GodotExe = "C:\Users\appsk\Documents\Github\equipmentGAME\Godot_v4.6.2-stable_win64_console.exe",
  [string]$ProjectPath = "C:\Users\appsk\Documents\Github\equipmentGameGodot",
  [int]$DebounceMs = 700,
  [int]$PollMs = 350,
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"

function Assert-PathExists {
  param(
    [string]$TargetPath,
    [string]$Name
  )
  if (-not (Test-Path $TargetPath)) {
    throw "$Name not found: $TargetPath"
  }
}

function Start-Godot {
  param(
    [string]$Exe,
    [string]$Proj
  )
  Write-Host "[watch-run] starting Godot..."
  return Start-Process -FilePath $Exe -ArgumentList @("--path", $Proj) -PassThru
}

function Stop-Godot {
  param([System.Diagnostics.Process]$Proc)
  if ($null -eq $Proc) { return }
  if (-not $Proc.HasExited) {
    try {
      Write-Host "[watch-run] stopping Godot pid=$($Proc.Id)"
      Stop-Process -Id $Proc.Id -Force
    } catch {
      Write-Warning "[watch-run] failed to stop process: $($_.Exception.Message)"
    }
  }
}

function Get-MainSceneAbsPath {
  param([string]$Proj)
  $projectFile = Join-Path $Proj "project.godot"
  $content = Get-Content $projectFile -ErrorAction Stop
  $line = $content | Where-Object { $_ -match '(^|\s)(run/main_scene|config/run/main_scene)="res://[^"]+"' } | Select-Object -First 1
  if (-not $line) {
    throw "Unable to find run/main_scene in $projectFile"
  }
  $sceneRel = ([regex]::Match($line, '"res://([^"]+)"').Groups[1].Value).Replace("/", "\")
  return Join-Path $Proj $sceneRel
}

function Add-SceneDependencies {
  param(
    [string]$FilePath,
    [string]$Proj,
    [System.Collections.Generic.HashSet[string]]$Visited,
    [System.Collections.Generic.HashSet[string]]$WatchSet
  )

  $abs = [System.IO.Path]::GetFullPath($FilePath)
  if ($Visited.Contains($abs)) { return }
  $Visited.Add($abs) | Out-Null
  if (-not (Test-Path $abs)) { return }

  $WatchSet.Add($abs) | Out-Null
  $ext = [System.IO.Path]::GetExtension($abs).ToLowerInvariant()
  if ($ext -ne ".tscn") { return }

  $lines = Get-Content $abs -ErrorAction SilentlyContinue
  foreach ($line in $lines) {
    $matches = [regex]::Matches($line, 'path="res://([^"]+)"')
    foreach ($m in $matches) {
      $rel = $m.Groups[1].Value.Replace("/", "\")
      $dep = Join-Path $Proj $rel
      $depAbs = [System.IO.Path]::GetFullPath($dep)
      if (Test-Path $depAbs) {
        $WatchSet.Add($depAbs) | Out-Null
        if ([System.IO.Path]::GetExtension($depAbs).ToLowerInvariant() -eq ".tscn") {
          Add-SceneDependencies -FilePath $depAbs -Proj $Proj -Visited $Visited -WatchSet $WatchSet
        }
      }
    }
  }
}

function Build-CurrentSceneWatchSet {
  param([string]$Proj)
  $set = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  $visited = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

  $projectFile = [System.IO.Path]::GetFullPath((Join-Path $Proj "project.godot"))
  $set.Add($projectFile) | Out-Null

  $mainScene = Get-MainSceneAbsPath -Proj $Proj
  Add-SceneDependencies -FilePath $mainScene -Proj $Proj -Visited $visited -WatchSet $set

  return $set
}

function Snapshot-WatchState {
  param([System.Collections.Generic.HashSet[string]]$WatchSet)
  $state = @{}
  foreach ($p in $WatchSet) {
    if (Test-Path $p) {
      $item = Get-Item $p -ErrorAction SilentlyContinue
      if ($item) {
        $state[$p] = @{
          Exists = $true
          LastWrite = $item.LastWriteTimeUtc.Ticks
          Length = if (-not $item.PSIsContainer) { $item.Length } else { 0 }
        }
        continue
      }
    }
    $state[$p] = @{ Exists = $false; LastWrite = 0; Length = 0 }
  }
  return $state
}

function Get-ChangedPaths {
  param(
    [System.Collections.Generic.HashSet[string]]$WatchSet,
    [hashtable]$PrevState
  )
  $changed = New-Object System.Collections.Generic.List[string]
  foreach ($p in $WatchSet) {
    $exists = Test-Path $p
    $last = 0
    $len = 0
    if ($exists) {
      $item = Get-Item $p -ErrorAction SilentlyContinue
      if ($item) {
        $last = $item.LastWriteTimeUtc.Ticks
        if (-not $item.PSIsContainer) { $len = $item.Length }
      }
    }
    $prev = $PrevState[$p]
    if ($null -eq $prev) {
      $changed.Add($p) | Out-Null
      continue
    }
    if (($prev.Exists -ne $exists) -or ($prev.LastWrite -ne $last) -or ($prev.Length -ne $len)) {
      $changed.Add($p) | Out-Null
    }
  }
  return $changed
}

Assert-PathExists -TargetPath $GodotExe -Name "Godot executable"
Assert-PathExists -TargetPath (Join-Path $ProjectPath "project.godot") -Name "project.godot"

if ($ValidateOnly) {
  $watchSet = Build-CurrentSceneWatchSet -Proj $ProjectPath
  Write-Host "[watch-run] validation OK"
  Write-Host "GodotExe   : $GodotExe"
  Write-Host "ProjectPath: $ProjectPath"
  Write-Host "Scope      : current-scene-related files only"
  Write-Host "WatchCount : $($watchSet.Count)"
  exit 0
}

$watchSet = Build-CurrentSceneWatchSet -Proj $ProjectPath
$state = Snapshot-WatchState -WatchSet $watchSet

$proc = $null
$lastRestartAt = Get-Date
try {
  $proc = Start-Godot -Exe $GodotExe -Proj $ProjectPath
  Write-Host "[watch-run] scope=current-scene, files=$($watchSet.Count). Press Ctrl+C to stop."

  while ($true) {
    Start-Sleep -Milliseconds $PollMs

    if ($proc -and $proc.HasExited) {
      Write-Host "[watch-run] Godot exited. Restarting..."
      Start-Sleep -Milliseconds 300
      $proc = Start-Godot -Exe $GodotExe -Proj $ProjectPath
      $watchSet = Build-CurrentSceneWatchSet -Proj $ProjectPath
      $state = Snapshot-WatchState -WatchSet $watchSet
      $lastRestartAt = Get-Date
      continue
    }

    $changed = Get-ChangedPaths -WatchSet $watchSet -PrevState $state
    if ($changed.Count -gt 0) {
      $sinceRestart = ((Get-Date) - $lastRestartAt).TotalMilliseconds
      if ($sinceRestart -lt $DebounceMs) {
        continue
      }

      $preview = ($changed | Select-Object -First 3 | ForEach-Object {
        $_.Replace($ProjectPath, "").TrimStart("\")
      }) -join ", "
      Write-Host "[watch-run] scene-related change detected: $preview"

      Stop-Godot -Proc $proc
      Start-Sleep -Milliseconds 300
      $proc = Start-Godot -Exe $GodotExe -Proj $ProjectPath

      # Rebuild dependency graph in case current scene resources changed.
      $watchSet = Build-CurrentSceneWatchSet -Proj $ProjectPath
      $state = Snapshot-WatchState -WatchSet $watchSet
      $lastRestartAt = Get-Date
    } else {
      $state = Snapshot-WatchState -WatchSet $watchSet
    }
  }
} finally {
  Stop-Godot -Proc $proc
}
