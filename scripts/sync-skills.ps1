param(
  [string]$src = ".\.vscode\prompts\skills",
  [string]$dest = "$env:APPDATA\Code\User\prompts\skills"
)

Write-Host "同步 SKILL 檔案 from $src to $dest"
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Get-ChildItem -Path $src -Directory | ForEach-Object {
  $folder = $_.Name
  $srcFolder = Join-Path $src $folder
  $destFolder = Join-Path $dest $folder
  Write-Host "Copying $srcFolder -> $destFolder"
  New-Item -ItemType Directory -Path $destFolder -Force | Out-Null
  Copy-Item -Path (Join-Path $srcFolder "SKILL.md") -Destination $destFolder -Force
}
Write-Host "同步完成。"
