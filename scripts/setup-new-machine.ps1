# equipmentGAME 新機器一鍵安裝腳本（Windows PowerShell）
#
# 用途：
#   在乾淨的 Windows 機器上，自動裝齊所有先決條件 + clone repo + npm install + 開機自啟設定。
#   不會自動執行：填 .env、DB 還原（這些必須人工操作）
#
# 用法：
#   1. 用系統管理員開 PowerShell
#   2. Set-ExecutionPolicy -Scope Process Bypass
#   3. .\setup-new-machine.ps1
#
# 完成後接著做：
#   - 編輯 .env（從舊機器複製或照 .env.example 填）
#   - mongorestore（從舊機器 dump 的 backup）
#   - cloudflared tunnel 設定
#   - npm run pm2:reset

$ErrorActionPreference = "Stop"
$WorkDir = "$env:USERPROFILE\Documents\Github"
$AppRepoUrl = "https://github.com/appskm20049f6/equipmentGAME-app.git"
$MainRepoUrl = ""  # ← 主 repo URL（如要 git clone，填這裡；不填則跳過 clone）

Write-Host "===== equipmentGAME 新機器安裝 =====" -ForegroundColor Cyan
Write-Host ""

# --- Step 1: 檢查管理員權限 ---
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
if (-not $isAdmin) {
  Write-Host "[ERROR] 請用「以系統管理員身分執行」開啟 PowerShell" -ForegroundColor Red
  exit 1
}

# --- Step 2: 安裝 Chocolatey（套件管理器） ---
if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
  Write-Host "[1/8] 安裝 Chocolatey ..." -ForegroundColor Yellow
  Set-ExecutionPolicy Bypass -Scope Process -Force
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
  iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
} else {
  Write-Host "[1/8] Chocolatey 已安裝 ✓" -ForegroundColor Green
}

# 重新載入 PATH
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# --- Step 3: Node.js 20 ---
$nodeVer = (Get-Command node -ErrorAction SilentlyContinue)?.Version?.Major
if (-not $nodeVer -or $nodeVer -lt 20) {
  Write-Host "[2/8] 安裝 Node.js 20 LTS ..." -ForegroundColor Yellow
  choco install nodejs-lts -y --version 20.18.0
} else {
  Write-Host "[2/8] Node.js v$nodeVer ✓" -ForegroundColor Green
}

# --- Step 4: Git ---
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "[3/8] 安裝 Git ..." -ForegroundColor Yellow
  choco install git -y
} else {
  Write-Host "[3/8] Git 已安裝 ✓" -ForegroundColor Green
}

# --- Step 5: MongoDB Community 7.0 ---
$mongoSvc = Get-Service -Name MongoDB -ErrorAction SilentlyContinue
if (-not $mongoSvc) {
  Write-Host "[4/8] 安裝 MongoDB Community 7.0 ..." -ForegroundColor Yellow
  choco install mongodb -y --version 7.0.5
} else {
  Write-Host "[4/8] MongoDB 已安裝 ✓" -ForegroundColor Green
}

# 啟動 MongoDB service
$mongoSvc = Get-Service -Name MongoDB -ErrorAction SilentlyContinue
if ($mongoSvc -and $mongoSvc.Status -ne "Running") {
  Write-Host "    → 啟動 MongoDB service ..." -ForegroundColor Yellow
  Start-Service MongoDB
}
Set-Service -Name MongoDB -StartupType Automatic -ErrorAction SilentlyContinue

# --- Step 6: PM2 + pm2-windows-startup ---
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
  Write-Host "[5/8] 安裝 PM2 + pm2-windows-startup ..." -ForegroundColor Yellow
  npm install -g pm2 pm2-windows-startup
  pm2-startup install
} else {
  Write-Host "[5/8] PM2 已安裝 ✓" -ForegroundColor Green
}

# --- Step 7: Cloudflared ---
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  Write-Host "[6/8] 安裝 cloudflared ..." -ForegroundColor Yellow
  choco install cloudflared -y
} else {
  Write-Host "[6/8] cloudflared 已安裝 ✓" -ForegroundColor Green
}

# --- Step 8: Clone repo + npm install ---
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

if ($MainRepoUrl) {
  if (-not (Test-Path "$WorkDir\equipmentGAME")) {
    Write-Host "[7/8] Clone 主 repo ..." -ForegroundColor Yellow
    git clone $MainRepoUrl "$WorkDir\equipmentGAME"
    Push-Location "$WorkDir\equipmentGAME"
    npm install
    Pop-Location
  } else {
    Write-Host "[7/8] 主 repo 已存在於 $WorkDir\equipmentGAME ✓" -ForegroundColor Green
  }
} else {
  Write-Host "[7/8] 主 repo URL 未設定，跳過 clone（請手動）" -ForegroundColor DarkYellow
}

if (-not (Test-Path "$WorkDir\equipmentGAME-app")) {
  Write-Host "[8/8] Clone 前端 repo ..." -ForegroundColor Yellow
  git clone $AppRepoUrl "$WorkDir\equipmentGAME-app"
  Push-Location "$WorkDir\equipmentGAME-app"
  npm install
  Pop-Location
} else {
  Write-Host "[8/8] 前端 repo 已存在 ✓" -ForegroundColor Green
}

# --- 完成 ---
Write-Host ""
Write-Host "===== 安裝完成 =====" -ForegroundColor Cyan
Write-Host ""
Write-Host "接下來請手動完成：" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. 把舊機器的 .env 複製到 $WorkDir\equipmentGAME\.env" -ForegroundColor White
Write-Host "   （如果是新環境，參考 .env.example 填）"
Write-Host ""
Write-Host "2. 還原資料庫（如有舊資料）：" -ForegroundColor White
Write-Host "   mongorestore --uri='mongodb://localhost:27017' --db=equipment_game --drop <backup-dir>\equipment_game"
Write-Host ""
Write-Host "3. 把舊機器的 ~\.cloudflared\ 整個複製到 $env:USERPROFILE\.cloudflared\" -ForegroundColor White
Write-Host "   然後執行： cloudflared service install"
Write-Host ""
Write-Host "4. 啟動主程式：" -ForegroundColor White
Write-Host "   cd $WorkDir\equipmentGAME"
Write-Host "   npm run pm2:reset"
Write-Host "   pm2 save"
Write-Host ""
Write-Host "5. 驗證：" -ForegroundColor White
Write-Host "   npm run pm2:status"
Write-Host "   curl http://localhost:5566/api/health"
Write-Host "   curl https://otonashikoi.org/api/health"
Write-Host ""
Write-Host "完整指南：docs\DEPLOYMENT_GUIDE.md" -ForegroundColor Cyan
